import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { TrackSource } from "livekit-server-sdk";
import { buildSummaryPrompt, CODE_EVALUATIONS_JSON_FIELD, codeSnippetsSection } from "@/lib/ai/prompts/summary";
import {
  BOARD_LIVE_MAX_BYTES,
  BOARD_SNAPSHOT_MAX_CHARS,
  boardTaskKey,
  canControlBoards,
  checkSnapshot,
  codeContextPrompt,
  isCandidatePacket,
  isServerPacket,
  livePacket,
  normalizeBoardState,
  normalizeCodeEvaluations,
  normalizeTask,
  parseLivePacket,
  roundTwoRunAllowed,
  snippetsFromSnapshots,
  taskFromBankItem,
  taskFromGenerated,
  withCodeEvaluations,
  PREVIEW_MAX_CHARS,
  TASK_STATUS_LABELS,
  checkPreview,
  giveTaskState,
  normalizeRunOutput,
  statusAfterSave,
  taskLocked,
} from "@/lib/round-two/boards";
import { admittedCandidatePermission, roomGrant } from "@/lib/round-two/grants";

const read = (p: string) => readFileSync(p, "utf8");

describe("round 2 grants", () => {
  it("lets the panel and admitted candidate publish data + screen share", () => {
    for (const kind of ["panel", "candidate"] as const) {
      const g = roomGrant(kind, "room");
      assert.equal(g.canPublishData, true, kind);
      assert.ok(g.canPublishSources?.includes(TrackSource.SCREEN_SHARE), kind);
    }
    const admit = admittedCandidatePermission();
    assert.equal(admit.canPublishData, true);
    assert.ok(admit.canPublishSources.includes(TrackSource.SCREEN_SHARE));
  });

  it("keeps the lobby and the agent from publishing anything", () => {
    const lobby = roomGrant("candidate_lobby", "room");
    assert.equal(lobby.canPublish, false);
    assert.equal(lobby.canPublishData, false);
    const agent = roomGrant("agent", "room");
    assert.equal(agent.canPublish, false);
    assert.equal(agent.canPublishData, false);
    assert.equal(agent.hidden, true);
  });

  it("observers get camera + mic only: no screen share, no data", () => {
    const g = roomGrant("observer", "room");
    assert.equal(g.canPublishData, false);
    assert.deepEqual(g.canPublishSources, [TrackSource.CAMERA, TrackSource.MICROPHONE]);
  });

  it("joinToken mints the observer kind for observers", () => {
    const src = read("src/server/routers/roundTwo.ts");
    assert.match(src, /kind: access\.role === "observer" \? "observer" : "panel"/);
    assert.match(read("src/lib/livekit.ts"), /roomGrant\(opts\.kind, opts\.room\)/);
    assert.match(read("src/lib/livekit.ts"), /permission: admittedCandidatePermission\(\)/);
  });
});

describe("round 2 board control (observer block)", () => {
  it("only host and interviewers control boards", () => {
    assert.equal(canControlBoards("host"), true);
    assert.equal(canControlBoards("interviewer"), true);
    assert.equal(canControlBoards("observer"), false);
    assert.equal(canControlBoards(undefined), false);
  });

  it("server enforces it on giveTask, endTask, codingTasks, generateCodingTask and askToShare", () => {
    const src = read("src/server/routers/roundTwo.ts");
    for (const proc of ["giveTask", "endTask", "codingTasks", "generateCodingTask", "askToShare"]) {
      const start = src.indexOf(`  ${proc}: protectedProcedure`);
      assert.ok(start > 0, proc);
      const body = src.slice(start, src.indexOf("\n  }),", start));
      assert.match(body, /if \(!canControlBoards\(access\.role\)\) throw new TRPCError\(\{ code: "FORBIDDEN"/, proc);
    }
  });

  it("server-only topics accept only server packets; board snapshots only from the candidate", () => {
    assert.equal(isServerPacket(undefined), true);
    assert.equal(isServerPacket({ identity: "user:x" }), false);
    assert.equal(isServerPacket({ identity: "cand:x" }), false);
    assert.equal(isCandidatePacket({ identity: "cand:r1" }), true);
    assert.equal(isCandidatePacket({ identity: "user:u1" }), false);
    assert.equal(isCandidatePacket(undefined), false);
  });
});

describe("round 2 candidate code runs", () => {
  it("is allowed only while live and admitted", () => {
    assert.equal(roundTwoRunAllowed({ status: "live", candidateAdmittedAt: "2026-11-26T10:00:00Z" }), true);
    assert.equal(roundTwoRunAllowed({ status: "live", candidateAdmittedAt: null }), false);
    assert.equal(roundTwoRunAllowed({ status: "ended", candidateAdmittedAt: "2026-11-26T10:00:00Z" }), false);
    assert.equal(roundTwoRunAllowed({ status: "scheduled", candidateAdmittedAt: null }), false);
    assert.equal(roundTwoRunAllowed(null), false);
  });

  it("code.run checks the token hash and keeps the per-session limits (keyed by the round)", () => {
    const src = read("src/server/routers/code.ts");
    assert.match(src, /\.eq\("candidateTokenHash", hashRoundToken\(input\.roundTwo\.token\)\)/);
    assert.match(src, /roundTwoRunAllowed\(data\)/);
    assert.match(src, /limiter\.acquire\(\{ sessionId: sessionId \?\? \(roundTwoId \? `r2:\$\{roundTwoId\}` : null\), userId, organizationId \}\)/);
    assert.match(src, /if \(!sessionId && !roundTwoId && !userId\) throw/);
  });
});

describe("round 2 board persistence", () => {
  it("normalizes state and tasks", () => {
    assert.deepEqual(normalizeBoardState(null), { coding: false, whiteboard: false, task: null, status: null });
    const st = normalizeBoardState({ coding: true, whiteboard: "yes", task: { prompt: "  Reverse a list  ", language: "py", source: "x" } });
    assert.equal(st.coding, true);
    assert.equal(st.whiteboard, false);
    assert.equal(st.task?.prompt, "Reverse a list");
    assert.equal(st.task?.source, "typed");
    assert.equal(normalizeTask({ prompt: "   " }), null);
    assert.equal(normalizeTask({ prompt: "x".repeat(10_000) })?.prompt.length, 4_000);
  });

  it("caps and validates snapshots", () => {
    assert.equal(checkSnapshot("coding", JSON.stringify({ code: "print(1)", language: "python" })).ok, true);
    assert.equal(checkSnapshot("coding", JSON.stringify({ elements: [] })).ok, false);
    assert.equal(checkSnapshot("whiteboard", JSON.stringify({ elements: [] })).ok, true);
    assert.equal(checkSnapshot("notes", "{}").ok, false);
    assert.equal(checkSnapshot("coding", "not json").ok, false);
    const big = JSON.stringify({ code: "x".repeat(BOARD_SNAPSHOT_MAX_CHARS) });
    assert.equal(checkSnapshot("coding", big).ok, false);
  });

  it("keys snapshots per task and drops stale/oversized live packets", () => {
    const task = normalizeTask({ id: "t1", prompt: "Sum" })!;
    assert.equal(boardTaskKey("coding", { task }), "t1");
    assert.equal(boardTaskKey("coding", { task: null }), "free");
    assert.equal(boardTaskKey("whiteboard", { task }), "t1");
    assert.equal(boardTaskKey("whiteboard", { task: null }), "whiteboard");
    const data = JSON.stringify({ code: "a=1", language: "python", drafts: { javascript: "x".repeat(5000) } });
    const pkt = livePacket("coding", "t1", data)!;
    const msg = parseLivePacket(pkt)!;
    assert.equal(msg.taskId, "t1");
    assert.deepEqual(JSON.parse(msg.data), { code: "a=1", language: "python" });
    assert.equal(livePacket("coding", "t1", JSON.stringify({ code: "y".repeat(BOARD_LIVE_MAX_BYTES), language: "python" })), null);
    assert.equal(parseLivePacket('{"kind":"coding","data":"x"}'), null);
  });

  it("migration 51 stores board state + capped snapshots behind RLS", () => {
    const sql = read("db/init/51-round-two-boards.sql");
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "boardState" jsonb/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.round_two_board_snapshots/);
    assert.match(sql, /CHECK \(length\(data\) <= 200000\)/);
    assert.match(sql, /\("roundTwoId", "taskId", kind\)/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /GRANT ALL ON public\.round_two_board_snapshots TO service_role/);
  });

  it("candidate save route is rate-limited, size-capped and live+admitted only; end flushes first", () => {
    const route = read("src/app/api/round-two/candidate/board/route.ts");
    assert.match(route, /rejectCrossSiteRequest\(req, \{ json: true \}\)/);
    assert.match(route, /checkRateLimit\(/);
    assert.match(route, /BOARD_SNAPSHOT_MAX_CHARS \+ PREVIEW_MAX_CHARS/);
    assert.match(route, /roundTwoRunAllowed\(/);
    const router = read("src/server/routers/roundTwo.ts");
    const end = router.slice(router.indexOf("  end: protectedProcedure"));
    assert.ok(end.indexOf("saveBoardSnapshot") < end.indexOf("runRoundTwoReport"));
    assert.match(route, /taskId: parsed\.data\.taskId/);
  });

  it("feeds the latest code to the copilot and live scoring", () => {
    const task = normalizeTask({ id: "t1", prompt: "Two sum" });
    const p = codeContextPrompt(task, JSON.stringify({ code: "def f(): pass", language: "python" }));
    assert.match(p, /Task: Two sum/);
    assert.match(p, /def f\(\): pass/);
    assert.equal(codeContextPrompt(null, null), "");
    assert.match(read("src/server/round-two/copilot.ts"), /codeText: await latestCodeContext\(roundTwoId\)/);
    assert.match(read("src/server/round-two/live-score.ts"), /latestCodeContext\(roundTwoId\)/);
  });
});

describe("round 2 task sources", () => {
  it("bank CODING items keep their starter", () => {
    const t = taskFromBankItem({ id: "q1", text: "FizzBuzz", description: "1..n", starterCode: { language: "javascript", code: "function f(n) {}" } })!;
    assert.equal(t.source, "bank");
    assert.equal(t.language, "javascript");
    assert.equal(t.starter, "function f(n) {}");
    assert.match(t.prompt, /FizzBuzz\n\n1\.\.n/);
  });

  it("AI output in the generator's shape becomes a task", () => {
    const t = taskFromGenerated({ title: "Dedupe", question: "Remove duplicates", starterCode: { language: "python", code: "def dedupe(xs):\n    pass" } }, "javascript")!;
    assert.equal(t.source, "ai");
    assert.equal(t.language, "python");
    assert.equal(taskFromGenerated({ question: "" }, "python"), null);
  });
});

describe("round 2 report code review", () => {
  const rows = [
    { taskId: "t1", kind: "coding", task: { id: "t1", prompt: "Two sum", title: "Two sum" }, data: JSON.stringify({ code: "def two(): pass", language: "python" }) },
    { taskId: "free", kind: "coding", task: null, data: JSON.stringify({ code: "   ", language: "python" }) },
    { taskId: "whiteboard", kind: "whiteboard", task: null, data: "{}" },
  ];

  it("builds snippets from coding snapshots only (empty code skipped)", () => {
    const sn = snippetsFromSnapshots(rows);
    assert.equal(sn.length, 1);
    assert.deepEqual(sn[0], { id: "t1", label: "Two sum", code: "def two(): pass", language: "python", question: "Two sum", submitted: false, runOutput: "" });
    assert.match(codeSnippetsSection(sn), /--- Snippet 1 \[id=t1\]: "Two sum" \(python\) ---/);
  });

  it("keeps round 1's codeEvaluations shape and merges into the report", () => {
    const sn = snippetsFromSnapshots(rows);
    const evals = normalizeCodeEvaluations(
      [
        { snippetId: "t1", score: 14, evaluation: "ok", whatWentWrong: ["edge cases", 3], referenceCode: "x" },
        { snippetId: "t1", score: 2 },
        { snippetId: "nope", score: 5 },
        { snippetLabel: "Two sum", score: "n/a" },
      ],
      sn,
    );
    assert.equal(evals.length, 1);
    assert.equal(evals[0].score, 10);
    assert.deepEqual(evals[0].whatWentWrong, ["edge cases"]);
    assert.equal(evals[0].snippetLabel, "Two sum");
    for (const key of ["snippetId", "snippetLabel", "language", "question", "candidateAnswer", "expectedApproach", "referenceCode", "whatWentWrong", "levelNotes", "score", "evaluation"]) {
      assert.ok(key in evals[0], key);
      assert.ok(CODE_EVALUATIONS_JSON_FIELD.includes(`"${key}"`), key);
    }
    const base = { summary: "s" } as { summary: string; codeEvaluations?: typeof evals };
    assert.equal(withCodeEvaluations(base, []), base);
    assert.deepEqual(withCodeEvaluations(base, evals).codeEvaluations, evals);
  });

  it("round 1's summary prompt still carries the same code review pieces", () => {
    const msgs = buildSummaryPrompt("T", [{ role: "user", content: "hi" }], null, null, null, "en", null, [{ id: "a", label: "L", code: "c", language: "python" }]);
    const text = msgs.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    assert.ok(text.includes(CODE_EVALUATIONS_JSON_FIELD));
    assert.match(text, /--- Snippet 1 \[id=a\]: "L" \(python\) ---/);
  });

  it("the report graph runs code_review between draft and verify", () => {
    const src = read("src/server/round-two/report.ts");
    assert.match(src, /\.addNode\("code_review", codeReview\)/);
    assert.match(src, /\.addEdge\("code_review", "verify"\)/);
    assert.match(src, /withCodeEvaluations\(s\.report as RoundTwoReport, evals\)/);
  });
});

describe("round 2 tasks: give, work, submit, end", () => {
  const task = normalizeTask({ id: "t1", kind: "whiteboard", prompt: "Draw a cache", starter: "ignored" })!;

  it("a drawing task opens the whiteboard (no starter); a coding task opens the editor", () => {
    assert.equal(task.kind, "whiteboard");
    assert.equal(task.starter, null);
    assert.deepEqual(giveTaskState(task), { coding: false, whiteboard: true, task, status: "sent" });
    const coding = normalizeTask({ id: "t2", prompt: "Sum", language: "python", starter: "def f(): pass" })!;
    const st = giveTaskState(coding);
    assert.equal(st.coding, true);
    assert.equal(st.whiteboard, false);
    assert.equal(st.status, "sent");
  });

  it("status goes sent -> working on the first save, submitted is final", () => {
    assert.equal(statusAfterSave("sent", false), "working");
    assert.equal(statusAfterSave("working", false), "working");
    assert.equal(statusAfterSave("working", true), "submitted");
    assert.equal(statusAfterSave("sent", true), "submitted");
    assert.equal(statusAfterSave("submitted", false), "submitted");
    assert.equal(statusAfterSave("submitted", true), "submitted");
    assert.equal(taskLocked("submitted"), true);
    assert.equal(taskLocked("ended"), true);
    assert.equal(taskLocked("working"), false);
    assert.equal(TASK_STATUS_LABELS.submitted, "Submitted ✓");
  });

  it("normalizes state status and keeps the task through a round trip", () => {
    const st = normalizeBoardState({ coding: true, task: { prompt: "x", id: "a" }, status: "weird" });
    assert.equal(st.status, "sent");
    assert.equal(normalizeBoardState({ coding: true, status: "working" }).status, null);
    assert.equal(normalizeBoardState(giveTaskState(task)).task?.kind, "whiteboard");
  });

  it("keeps only clipped run output and an SVG preview", () => {
    assert.equal(normalizeRunOutput({ stdout: "", stderr: "" }), null);
    assert.equal(normalizeRunOutput({ stdout: "x".repeat(9000), stderr: "e", language: "python", extra: 1 })?.stdout.length, 4_000);
    assert.equal(checkPreview("data:image/svg+xml;base64,AAAA"), "data:image/svg+xml;base64,AAAA");
    assert.equal(checkPreview("data:text/html;base64,AAAA"), null);
    assert.equal(checkPreview("javascript:alert(1)"), null);
    assert.equal(checkPreview("data:image/svg+xml," + "x".repeat(PREVIEW_MAX_CHARS)), null);
  });

  it("server: locked tasks refuse saves, stale task ids are refused, observers can't give or end", () => {
    const src = read("src/server/round-two/boards.ts");
    assert.match(src, /if \(taskLocked\(state\.status\)\) return \{ ok: false, error: "This task is already submitted", status: 409 \}/);
    assert.match(src, /opts\.taskId !== state\.task\.id/);
    assert.match(src, /\.neq\("status", "submitted"\)/);
    assert.match(src, /submittedAt: now, runOutput: normalizeRunOutput\(opts\.runOutput\), preview: checkPreview\(opts\.preview\)/);
    const router = read("src/server/routers/roundTwo.ts");
    assert.match(router, /The candidate isn't in the room yet/);
  });

  it("migration 52 adds task status/submission, scorecard feedback and candidate feedback", () => {
    const sql = read("db/init/52-round-two-tasks-feedback.sql");
    assert.match(sql, /round_two_board_snapshots[\s\S]*"submittedAt"[\s\S]*"runOutput"\s+jsonb[\s\S]*preview/);
    assert.match(sql, /status IN \('sent', 'working', 'submitted', 'ended'\)/);
    assert.match(sql, /"overallRating" smallint/);
    assert.match(sql, /strengths text NOT NULL DEFAULT ''/);
    assert.match(sql, /"candidateRating"\s+smallint/);
    assert.match(sql, /"candidateFeedbackAt"/);
  });

  it("submitted answers feed the report: snippets carry submitted + run output, evaluations carry submitted", () => {
    const rows = [
      { taskId: "t1", kind: "coding", status: "submitted", task: { id: "t1", prompt: "Two sum" }, data: JSON.stringify({ code: "x=1", language: "python" }), runOutput: { stdout: "3", stderr: "" } },
      { taskId: "t2", kind: "coding", status: "ended", task: { id: "t2", prompt: "Sum" }, data: JSON.stringify({ code: "y=2", language: "python" }) },
    ];
    const sn = snippetsFromSnapshots(rows);
    assert.equal(sn[0].submitted, true);
    assert.match(sn[0].runOutput, /stdout:\n3/);
    assert.equal(sn[1].submitted, false);
    const ev = normalizeCodeEvaluations([{ snippetId: "t1", score: 7 }, { snippetId: "t2", score: 4 }], sn);
    assert.deepEqual(ev.map((e) => e.submitted), [true, false]);
    assert.match(read("src/server/round-two/report.ts"), /candidate submitted/);
    assert.match(read("src/components/round-two/report-view.tsx"), /Not submitted/);
  });
});

describe("round 2 feedback after the interview", () => {
  it("panel scorecard saves overall rating, strengths and concerns per panelist; observers can't", () => {
    const router = read("src/server/routers/roundTwo.ts");
    const body = router.slice(router.indexOf("  saveScorecard: protectedProcedure"), router.indexOf("  end: protectedProcedure"));
    assert.match(body, /overallRating: z\.number\(\)\.int\(\)\.min\(1\)\.max\(5\)/);
    assert.match(body, /strengths: z\.string\(\)/);
    assert.match(body, /concerns: z\.string\(\)/);
    assert.match(body, /access\.role === "observer"\) throw new TRPCError\(\{ code: "FORBIDDEN"/);
    assert.match(body, /\.eq\("userId", ctx\.user\.id\)/);
    const report = read("src/server/round-two/report.ts");
    assert.match(report, /overallRating, strengths, concerns/);
    const room = read("src/app/r2/[id]/room/page.tsx");
    assert.match(room, /myRole !== "observer" && \(/);
    assert.match(room, /Give your feedback on the candidate/);
  });

  it("candidate feedback: ended rounds only, once, 1-5 stars, rate-limited, same-origin", () => {
    const route = read("src/app/api/round-two/candidate/feedback/route.ts");
    assert.match(route, /rating: z\.number\(\)\.int\(\)\.min\(1\)\.max\(5\)/);
    assert.match(route, /rejectCrossSiteRequest\(req, \{ json: true \}\)/);
    assert.match(route, /checkRateLimit\(/);
    assert.match(route, /round\.status !== "ended"/);
    assert.match(route, /candidateFeedbackAt\) return NextResponse\.json/);
    assert.match(route, /\.is\("candidateFeedbackAt", null\)/);
    const page = read("src/app/r2/c/[token]/page.tsx");
    assert.match(page, /CandidateFeedbackCard/);
    assert.match(read("src/app/(dashboard)/round-two/[id]/page.tsx"), /candidateFeedbackAt/);
  });
});
