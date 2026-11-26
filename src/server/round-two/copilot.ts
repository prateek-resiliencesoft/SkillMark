import "server-only";
import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { extractGrounded } from "@/lib/ai/extract";
import { runGraph, skipStep, step } from "@/lib/ai/graph/runtime";
import { createLogger } from "@/lib/logger";
import { listRoomIdentities, sendToIdentities } from "@/lib/livekit";
import {
  DATA_TOPICS,
  USER_IDENTITY_PREFIX,
  dedupeSuggestions,
  normalizeCopilot,
  normalizePlan,
  type CopilotResult,
  type GroundedClaim,
  type QuestionPlanItem,
  type Round1Context,
} from "@/lib/round-two/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callJson, clip } from "./ai";
import { relatedPairs, verifyFlags, type ClaimPair } from "./checks";
import { round1ContextPrompt } from "./context";
import { maybeRunLiveScoring, recordAiError } from "./live-score";

const log = createLogger("round-two/copilot");

/** Total LLM tokens one round 2 may spend on live copilot calls. */
const TOKEN_BUDGET = Number(process.env.ROUND2_AI_TOKEN_BUDGET) || 250_000;
/** Minimum gap between automatic (turn-triggered) runs per room. */
const MIN_TURN_GAP_MS = 8_000;
const TURN_DEBOUNCE_MS = 2_500;
type Trigger = "turn" | "manual" | "ask";

const g = globalThis as unknown as {
  __r2Copilot?: {
    running: Set<string>;
    lastRun: Map<string, number>;
    timers: Map<string, NodeJS.Timeout>;
    /** startMs of the newest candidate segment already mined for claims. */
    minedUpTo: Map<string, number>;
    /** Rooms already told they ran out of AI budget. */
    budgetNoted: Set<string>;
  };
};
const state = (g.__r2Copilot ??= { running: new Set(), lastRun: new Map(), timers: new Map(), minedUpTo: new Map(), budgetNoted: new Set() });
state.minedUpTo ??= new Map();
state.budgetNoted ??= new Set();

const SYSTEM = `You are a silent copilot for a human interview panel running a live round 2 interview.
The candidate cannot see you. You read the live transcript, the question plan, round 1 context, claims extracted from the latest answers with related earlier claims, and the panel's notes.
Produce JSON:
{"reasoning": string (2-4 short "- " bullets: what you noticed in the latest answer and why you suggest what you suggest),
 "suggestions": [{"type": "follow_up"|"cross_check"|"new_topic"|"clarify", "question": string, "reason": string, "planId": string?}] (3-5, best first; follow-ups dig into the last answer, cross_check compares with round 1 claims or the CV),
 "coveredQuestionIds": string[] (plan ids already answered in this round),
 "liveSummary": string (running summary of round 2 so far, <= 8 short bullet lines starting with "- "),
 "flags": [{"kind": "contradiction"|"vague"|"possible_assistance"|"red_flag"|"strength", "detail": string, "quote": string?, "round1Quote": string?}] (only new, evidence-backed flags; [] if none)}
Rules: questions are short and speakable; never invent facts; quotes must be copied verbatim; a contradiction needs both quotes; treat style differences as signals, not proof.`;

const CLAIM_CLASSES = [
  { name: "claim", description: "A factual statement about the candidate's own work, role, team or results" },
  { name: "metric", description: "A number the candidate gives (scale, %, time, money, team size)" },
  { name: "decision", description: "A technical or product decision the candidate says they made, with any reason" },
  { name: "tool", description: "A technology, tool or method the candidate says they used" },
];

interface Segment {
  speakerRole: string;
  speakerName: string | null;
  text: string;
  startMs: number;
}

const State = Annotation.Root({
  roundTwoId: Annotation<string>(),
  trigger: Annotation<Trigger>(),
  ask: Annotation<{ text: string; by: string } | null>(),
  organizationId: Annotation<string>(),
  livekitRoom: Annotation<string>(),
  plan: Annotation<QuestionPlanItem[]>(),
  covered: Annotation<string[]>(),
  round1: Annotation<Round1Context>(),
  liveSummary: Annotation<string>(),
  aiTokensUsed: Annotation<number>(),
  segments: Annotation<Segment[]>(),
  notesText: Annotation<string>(),
  priorClaims: Annotation<GroundedClaim[]>(),
  /** Questions the copilot already suggested in earlier runs (never offer them again). */
  priorSuggestions: Annotation<string[]>(),
  newText: Annotation<string>(),
  newUpTo: Annotation<number>(),
  claims: Annotation<GroundedClaim[]>(),
  pairs: Annotation<ClaimPair[]>(),
  result: Annotation<CopilotResult | null>(),
});
type S = typeof State.State;

function transcriptText(segs: Segment[]): string {
  return segs.map((s) => `${s.speakerRole === "candidate" ? "Candidate" : s.speakerName || "Interviewer"}: ${s.text}`).join("\n");
}

function buildGraph() {
  const load = step<S, Partial<S>>("load", "Reading the latest answers", async (s, ctx) => {
    const [{ data: segs }, { data: notes }, { data: events }] = await Promise.all([
      supabaseAdmin
        .from("round_two_transcript")
        .select('"speakerRole", "speakerName", text, "startMs"')
        .eq("roundTwoId", s.roundTwoId)
        .order("startMs", { ascending: false })
        .limit(60),
      supabaseAdmin
        .from("round_two_notes")
        .select('"authorName", body, kind')
        .eq("roundTwoId", s.roundTwoId)
        .eq("visibility", "shared")
        .order("createdAt", { ascending: false })
        .limit(12),
      supabaseAdmin
        .from("round_two_ai_events")
        .select("payload")
        .eq("roundTwoId", s.roundTwoId)
        .eq("kind", "suggestions")
        .order("createdAt", { ascending: false })
        .limit(10),
    ]);
    const segments = ((segs ?? []) as Segment[]).reverse();
    const minedUpTo = state.minedUpTo.get(s.roundTwoId) ?? -1;
    const fresh = segments.filter((x) => x.speakerRole === "candidate" && x.startMs > minedUpTo);
    const priorClaims = (events ?? []).flatMap((e) => ((e.payload as { claims?: GroundedClaim[] })?.claims ?? []));
    const priorSuggestions = (events ?? []).flatMap((e) =>
      ((e.payload as { suggestions?: Array<{ question?: string }> })?.suggestions ?? [])
        .map((x) => (typeof x?.question === "string" ? x.question : ""))
        .filter(Boolean),
    );
    const notesText = (notes ?? [])
      .reverse()
      .map((n) => `${n.authorName || "Panel"}: ${clip(n.body as string, 500)}`)
      .join("\n");
    ctx.note(
      `${segments.length} transcript line(s) · ${fresh.length} new candidate answer(s)${notes?.length ? ` · ${notes.length} panel note(s)` : ""}`,
    );
    return {
      segments,
      notesText,
      priorClaims,
      priorSuggestions,
      newText: fresh.map((x) => x.text).join("\n"),
      newUpTo: fresh.length ? fresh[fresh.length - 1].startMs : minedUpTo,
    };
  });

  const extract = step<S, Partial<S>>("extract_claims", "Extracting claims from the new answers", async (s, ctx) => {
    try {
      const r = await extractGrounded({
        source: clip(s.newText, 6_000),
        sourceId: "round2",
        classes: CLAIM_CLASSES,
        instructions: "The source is what a job candidate just said in a live interview. Extract checkable statements about their own experience.",
        organizationId: s.organizationId,
        task: "round2_live",
        maxPerChunk: 12,
        signal: ctx.signal,
      });
      const claims = r.items.map((x) => ({ class: x.class, text: x.text, attributes: x.attributes }));
      ctx.note(`${claims.length} grounded claim(s)${r.dropped ? `, ${r.dropped} unverifiable dropped` : ""}`);
      if (claims.length) ctx.think(claims.map((c) => `- [${c.class}] ${c.text}`).join("\n"));
      state.minedUpTo.set(s.roundTwoId, s.newUpTo);
      return { claims };
    } catch (err) {
      ctx.note(`Claim extraction failed (${err instanceof Error ? err.message : "error"}); continuing`);
      return { claims: [] };
    }
  });

  const crossCheck = step<S, Partial<S>>("cross_check", "Cross-checking with round 1, the CV and earlier answers", (s, ctx) => {
    const pairs = relatedPairs(s.claims, s.round1, s.priorClaims);
    ctx.note(pairs.length ? `${pairs.length} new claim(s) relate to earlier statements` : "Nothing related to earlier statements");
    if (pairs.length) ctx.think(pairs.map((p) => `- "${p.claim}" ↔ ${p.source}: "${clip(p.related, 200)}"`).join("\n"));
    return { pairs };
  });

  const suggest = step<S, Partial<S>>(
    "suggest",
    (s) => (s.ask ? "Answering the interviewer" : "Suggesting what to ask next"),
    async (s, ctx) => {
      const covered = new Set(s.covered);
      const planText = s.plan.map((q) => `[${q.id}]${covered.has(q.id) ? " (covered)" : ""} ${q.text}`).join("\n");
      const transcript = transcriptText(s.segments);
      const user = [
        round1ContextPrompt(s.round1),
        `Question plan:\n${planText || "(none)"}`,
        `Summary so far:\n${s.liveSummary || "(none)"}`,
        s.notesText ? `Panel notes:\n${s.notesText}` : "",
        s.pairs.length
          ? `New claims and related earlier statements (check for consistency):\n${s.pairs.map((p) => `- "${p.claim}" vs ${p.source}: "${p.related}"`).join("\n")}`
          : "",
        s.priorSuggestions.length
          ? `Questions you already suggested earlier (do NOT suggest these or close rephrasings again; move on to something new):\n${[...new Set(s.priorSuggestions)].slice(0, 20).map((q) => `- ${clip(q, 200)}`).join("\n")}`
          : "",
        `Live transcript (latest last):\n${clip(transcript, 14_000) || "(nothing said yet)"}`,
        s.ask ? `The interviewer ${s.ask.by} asks you: ${s.ask.text}` : "Suggest what to ask next.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const { data } = await callJson<Record<string, unknown>>({
        organizationId: s.organizationId,
        task: "round2_live",
        maxTokens: 1400,
        temperature: 0.4,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
        signal: ctx.signal ?? AbortSignal.timeout(45_000),
      });
      if (typeof data.reasoning === "string") ctx.think(clip(data.reasoning, 1500));
      const result = normalizeCopilot(data, s.plan.map((q) => q.id));
      // Never offer a question that was already suggested, or that the panel already asked aloud.
      const askedAloud = s.segments.filter((x) => x.speakerRole !== "candidate").map((x) => x.text);
      const before = result.suggestions.length;
      result.suggestions = dedupeSuggestions(result.suggestions, s.priorSuggestions, askedAloud);
      if (result.suggestions.length < before) ctx.note(`${before - result.suggestions.length} repeated suggestion(s) dropped`);
      const round1Text = [...(s.round1.candidateAnswers ?? []), ...(s.round1.claims ?? []).map((c) => c.evidence ?? c.claim)].join("\n");
      const candidateText = s.segments.filter((x) => x.speakerRole === "candidate").map((x) => x.text).join("\n");
      result.flags = verifyFlags(result.flags, candidateText, round1Text);
      const unverified = result.flags.filter((f) => !f.verified).length;
      ctx.note(
        `${result.suggestions.length} suggestion(s) · ${result.flags.length} flag(s)${unverified ? ` (${unverified} with unverified quotes)` : ""} · ${result.coveredQuestionIds.length} plan item(s) covered`,
      );
      return { result };
    },
  );

  return new StateGraph(State)
    .addNode("load", load)
    .addNode("extract_claims", extract)
    .addNode("cross_check", crossCheck)
    .addNode("suggest", suggest)
    .addEdge(START, "load")
    .addConditionalEdges(
      "load",
      (s: S, config: LangGraphRunnableConfig) => {
        if (!s.segments.length && s.trigger === "turn") return END;
        if (s.newText.trim().split(/\s+/).length >= 8) return "extract_claims";
        skipStep(config, "extract_claims", "Extracting claims from the new answers", "No substantial new answer since the last run");
        return "cross_check";
      },
      ["extract_claims", "cross_check", END],
    )
    .addEdge("extract_claims", "cross_check")
    .addEdge("cross_check", "suggest")
    .addEdge("suggest", END)
    .compile();
}

export type CopilotOutcome =
  | { ok: true; result: CopilotResult }
  | { ok: false; reason: "busy" | "not_live" | "budget" | "nothing_new" | "error"; message: string };

export async function runCopilot(
  roundTwoId: string,
  trigger: Trigger,
  ask?: { text: string; by: string },
): Promise<CopilotOutcome> {
  if (state.running.has(roundTwoId)) return { ok: false, reason: "busy", message: "The copilot is already working on the last answer." };
  state.running.add(roundTwoId);
  try {
    const { data: round } = await supabaseAdmin
      .from("round_two_interviews")
      .select('id, "organizationId", status, "livekitRoom", "questionPlan", "round1Context", "liveSummary", "coveredQuestionIds", "aiTokensUsed", "hostUserId"')
      .eq("id", roundTwoId)
      .maybeSingle();
    if (!round || round.status !== "live") return { ok: false, reason: "not_live", message: "Interview is not live." };
    if ((round.aiTokensUsed as number) >= TOKEN_BUDGET) {
      log.warn("AI budget reached", roundTwoId);
      const message = "This interview has used its AI budget (ROUND2_AI_TOKEN_BUDGET).";
      if (!state.budgetNoted.has(roundTwoId)) {
        state.budgetNoted.add(roundTwoId);
        await recordAiError(roundTwoId, "copilot", new Error(message), trigger);
      }
      return { ok: false, reason: "budget", message };
    }

    const r = await runGraph<S>(buildGraph(), {
      flow: "round2-copilot",
      organizationId: round.organizationId as string,
      subject: { type: "round_two", id: roundTwoId },
      traceInput: { trigger, ask: ask?.text ?? null },
      input: {
        roundTwoId,
        trigger,
        ask: ask ?? null,
        organizationId: round.organizationId as string,
        livekitRoom: round.livekitRoom as string,
        plan: normalizePlan(round.questionPlan),
        covered: (round.coveredQuestionIds as string[]) ?? [],
        round1: (round.round1Context ?? {}) as Round1Context,
        liveSummary: (round.liveSummary as string) ?? "",
        aiTokensUsed: round.aiTokensUsed as number,
        segments: [],
        notesText: "",
        priorClaims: [],
        priorSuggestions: [],
        newText: "",
        newUpTo: -1,
        claims: [],
        pairs: [],
        result: null,
      },
    });
    const s = r.state;
    if (!s.result) return { ok: false, reason: "nothing_new", message: "Nothing new to analyse yet." };

    const result = s.result;
    const mergedCovered = Array.from(new Set([...s.covered, ...result.coveredQuestionIds]));
    const [, ins] = await Promise.all([
      supabaseAdmin
        .from("round_two_interviews")
        .update({
          liveSummary: result.liveSummary || s.liveSummary,
          coveredQuestionIds: mergedCovered,
          aiTokensUsed: s.aiTokensUsed + r.tokens,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", roundTwoId),
      supabaseAdmin.from("round_two_ai_events").insert({
        roundTwoId,
        kind: "suggestions",
        trigger,
        runId: r.runId,
        payload: { ...result, ask: ask ?? null, claims: s.claims, steps: r.steps },
      }),
    ]);
    if (ins.error) log.warn("copilot event insert failed", roundTwoId, ins.error.message);

    const panel = (await listRoomIdentities(s.livekitRoom)).filter((i) => i.startsWith(USER_IDENTITY_PREFIX));
    await sendToIdentities(s.livekitRoom, panel, DATA_TOPICS.copilot, { roundTwoId, trigger });
    return { ok: true, result: { ...result, coveredQuestionIds: mergedCovered } };
  } catch (err) {
    log.error("copilot run failed", roundTwoId, err instanceof Error ? err.message : err);
    return { ok: false, reason: "error", message: await recordAiError(roundTwoId, "copilot", err, trigger) };
  } finally {
    state.lastRun.set(roundTwoId, Date.now());
    state.running.delete(roundTwoId);
  }
}

/** Debounced auto-run after the candidate finishes a turn. */
export function scheduleTurnCopilot(roundTwoId: string): void {
  const existing = state.timers.get(roundTwoId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    state.timers.delete(roundTwoId);
    const since = Date.now() - (state.lastRun.get(roundTwoId) ?? 0);
    // A manual/ask run in progress or a run just finished: try again shortly so this turn isn't lost.
    if (since < MIN_TURN_GAP_MS || state.running.has(roundTwoId)) {
      scheduleTurnCopilot(roundTwoId);
      return;
    }
    void runCopilot(roundTwoId, "turn").then(() => maybeRunLiveScoring(roundTwoId));
  }, TURN_DEBOUNCE_MS);
  timer.unref?.();
  state.timers.set(roundTwoId, timer);
}
