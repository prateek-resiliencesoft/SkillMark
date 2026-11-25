"use client";

import { ReasoningTimeline } from "@/components/ai/reasoning-timeline";
import { CATEGORY_LABELS } from "@/components/round-two/plan-editor";
import { StyleTable } from "@/components/round-two/report-view";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  RECOMMENDATIONS,
  RECOMMENDATION_LABELS,
  ROUND2_RUBRIC,
  type CopilotFlag,
  type CopilotSuggestion,
  type QuestionPlanItem,
  type Recommendation,
  type Round1Context,
} from "@/lib/round-two/types";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/routers/_app";
import type { inferRouterOutputs } from "@trpc/server";
import { cn } from "@/lib/utils";
import { AlertTriangle, Gauge, Loader2, Lock, RefreshCw, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const TABS = [
  ["copilot", "Copilot"],
  ["plan", "Plan"],
  ["transcript", "Transcript"],
  ["round1", "Round 1"],
  ["cv", "CV"],
  ["compare", "Compare"],
  ["notes", "Notes"],
  ["score", "Scorecard"],
] as const;
type TabId = (typeof TABS)[number][0];

const SUGGESTION_STYLE: Record<CopilotSuggestion["type"], string> = {
  follow_up: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  cross_check: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  new_topic: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  clarify: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

const FLAG_STYLE: Record<CopilotFlag["kind"], string> = {
  contradiction: "border-amber-600/50",
  vague: "border-slate-500/40",
  possible_assistance: "border-red-600/50",
  red_flag: "border-red-600/50",
  strength: "border-green-600/50",
};

const RUBRIC: readonly string[] = ROUND2_RUBRIC;

type LiveData = inferRouterOutputs<AppRouter>["roundTwo"]["live"];
type LiveScores = NonNullable<LiveData["liveScores"]>;

export function PanelSidebar({
  roundTwoId,
  plan,
  round1,
  myRole,
  live,
  myScorecard,
}: {
  roundTwoId: string;
  plan: QuestionPlanItem[];
  round1: Round1Context;
  myRole: string;
  live: LiveData | undefined;
  myScorecard: Record<string, unknown> | null;
}) {
  const [tab, setTab] = useState<TabId>("copilot");
  const lastFlagCount = useRef(0);
  const [newFlags, setNewFlags] = useState(0);

  useEffect(() => {
    const n = live?.flags.length ?? 0;
    if (n > lastFlagCount.current && tab !== "copilot" && tab !== "compare") setNewFlags(n - lastFlagCount.current);
    lastFlagCount.current = n;
  }, [live?.flags.length, tab]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b p-2">
        {TABS.filter(([id]) => id !== "score" || myRole !== "observer").map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              if (id === "copilot" || id === "compare") setNewFlags(0);
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {label}
            {id === "copilot" && newFlags > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1 text-[10px] text-white">{newFlags}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "copilot" && <CopilotTab roundTwoId={roundTwoId} live={live} plan={plan} />}
        {tab === "plan" && <PlanTab roundTwoId={roundTwoId} plan={plan} covered={live?.coveredQuestionIds ?? []} />}
        {tab === "transcript" && <TranscriptTab live={live} />}
        {tab === "round1" && <Round1Tab ctx={round1} />}
        {tab === "cv" && <CvTab ctx={round1} />}
        {tab === "compare" && <CompareTab live={live} />}
        {tab === "notes" && <NotesTab roundTwoId={roundTwoId} live={live} />}
        {tab === "score" && <ScorecardTab roundTwoId={roundTwoId} initial={myScorecard} aiScores={live?.liveScores ?? null} />}
      </div>
    </div>
  );
}

function CopilotTab({ roundTwoId, live, plan }: { roundTwoId: string; live: LiveData | undefined; plan: QuestionPlanItem[] }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [ask, setAsk] = useState("");
  const mutation = trpc.roundTwo.askCopilot.useMutation({
    onSuccess: () => {
      setAsk("");
      void utils.roundTwo.live.invalidate({ id: roundTwoId });
    },
    onError: (err) => toast({ title: "Copilot", description: err.message, variant: "destructive" }),
  });
  const latest = live?.copilot[0];
  const earlier = live?.copilot.slice(1, 6) ?? [];
  const heard = live?.transcript.length ?? 0;
  const candidateLines = live?.transcript.filter((t) => t.speakerRole === "candidate").length ?? 0;
  const planText = useMemo(() => new Map(plan.map((q) => [q.id, q.text])), [plan]);
  const recentFlags = (live?.flags ?? []).slice(0, 6);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              mutation.mutate({ id: roundTwoId, text: ask.trim() || undefined });
            }
          }}
          rows={2}
          className="text-sm"
          placeholder="Ask the copilot, e.g. 'They said they led the migration — how do I test that?'"
        />
        <div className="flex flex-col gap-1">
          <Button size="icon" onClick={() => mutation.mutate({ id: roundTwoId, text: ask.trim() || undefined })} disabled={mutation.isLoading} aria-label="Ask">
            {mutation.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : ask.trim() ? <Send className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground">Suggestions refresh automatically after each answer. Press the sparkle to refresh now.</p>

      {live?.aiError && (
        <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <div className="font-semibold">{live.aiError.stage === "scoring" ? "Live scoring" : "Copilot"} couldn&apos;t run</div>
            <div>{live.aiError.message}</div>
          </div>
        </div>
      )}

      {mutation.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> The copilot is analysing the conversation…
        </div>
      )}

      {latest ? (
        <div className="space-y-2">
          {latest.ask && (
            <p className="text-xs text-muted-foreground">
              {latest.ask.by} asked: “{latest.ask.text}”
            </p>
          )}
          {latest.suggestions.map((s, i) => (
            <div key={i} className="rounded-lg border bg-card p-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", SUGGESTION_STYLE[s.type])}>
                  {s.type.replace("_", " ")}
                </span>
                {s.planId && planText.get(s.planId) && <span className="truncate text-[10px] text-muted-foreground">plan: {planText.get(s.planId)}</span>}
              </div>
              <p className="text-sm font-medium">{s.question}</p>
              {s.reason && <p className="mt-0.5 text-xs text-muted-foreground">{s.reason}</p>}
            </div>
          ))}
          {!!latest.steps?.length && (
            <ReasoningTimeline steps={latest.steps} title="How the copilot got here" collapsible defaultOpen={false} />
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {!heard
            ? "Suggestions appear once the transcript starts. If people are talking and the Transcript tab stays empty, the transcription agent isn't receiving audio."
            : !candidateLines
              ? "Waiting for the candidate's first answer (admit them from the lobby). Press the sparkle to get suggestions now."
              : "Analysing the latest answers… press the sparkle to refresh now."}
        </div>
      )}

      <LiveScoresCard roundTwoId={roundTwoId} live={live} />

      {recentFlags.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold">Signals</div>
          {recentFlags.map((f, i) => (
            <FlagCard key={i} flag={f} />
          ))}
        </div>
      )}

      {live?.liveSummary && (
        <div>
          <div className="mb-1 text-xs font-semibold">Live summary</div>
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{live.liveSummary}</p>
        </div>
      )}

      {earlier.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Earlier suggestions</summary>
          <ul className="mt-1.5 space-y-1">
            {earlier.flatMap((e) =>
              e.suggestions.map((s, i) => (
                <li key={`${e.id}-${i}`} className="text-muted-foreground">
                  • {s.question}
                </li>
              )),
            )}
          </ul>
        </details>
      )}
    </div>
  );
}

const REC_TONE: Record<string, string> = {
  strong_no: "text-red-700 dark:text-red-400",
  no: "text-red-700 dark:text-red-400",
  lean_no: "text-amber-700 dark:text-amber-400",
  lean_yes: "text-emerald-700 dark:text-emerald-400",
  yes: "text-emerald-700 dark:text-emerald-400",
  strong_yes: "text-emerald-700 dark:text-emerald-400",
};

/** AI's suggested rubric scores during the interview. Suggestions only; the panel scores. */
function LiveScoresCard({ roundTwoId, live }: { roundTwoId: string; live: LiveData | undefined }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const refresh = trpc.roundTwo.scoreLive.useMutation({
    onSuccess: () => void utils.roundTwo.live.invalidate({ id: roundTwoId }),
    onError: (err) => toast({ title: "Live scoring", description: err.message, variant: "destructive" }),
  });
  if (live && !live.liveScoringEnabled) return null;
  const ls = live?.liveScores ?? null;
  return (
    <div className="rounded-lg border bg-card p-2.5 text-card-foreground">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Gauge className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Live AI scores</span>
        <span className="text-[10px] text-muted-foreground">suggestions · you decide</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          onClick={() => refresh.mutate({ id: roundTwoId })}
          disabled={refresh.isLoading}
          aria-label="Refresh live scores"
        >
          {refresh.isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {ls ? <LiveScoreRows scores={ls} /> : (
        <p className="text-xs text-muted-foreground">Scores appear after the candidate has answered a few questions (updated about once a minute).</p>
      )}
    </div>
  );
}

function LiveScoreRows({ scores }: { scores: LiveScores }) {
  return (
    <div className="space-y-1.5">
      {scores.scores.map((c) => (
        <div key={c.criterion} className="text-xs">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{c.criterion}</span>
            <span className="tabular-nums font-semibold">{c.score != null ? `${c.score}/5` : "—"}</span>
          </div>
          {c.reason && <p className="text-[11px] text-muted-foreground">{c.reason}</p>}
          {c.evidence && (
            <p className="text-[11px] italic text-muted-foreground">
              “{c.evidence}”{c.verified === false && " (quote not found in transcript)"}
            </p>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between border-t pt-1.5 text-[11px]">
        <span className={cn("font-semibold", scores.recommendation ? REC_TONE[scores.recommendation] : "text-muted-foreground")}>
          {scores.recommendation ? RECOMMENDATION_LABELS[scores.recommendation] : "Too early to recommend"}
        </span>
        <span className="text-muted-foreground">confidence {Math.round((scores.confidence ?? 0) * 100)}%</span>
      </div>
      {scores.summary && <p className="text-[11px] text-muted-foreground">{scores.summary}</p>}
    </div>
  );
}

function FlagCard({ flag }: { flag: CopilotFlag }) {
  return (
    <div className={cn("rounded-md border-l-4 border bg-card p-2 text-xs", FLAG_STYLE[flag.kind])}>
      <div className="flex items-center gap-1 font-semibold capitalize">
        {flag.kind !== "strength" && <AlertTriangle className="h-3 w-3" />}
        {flag.kind.replace("_", " ")}
        {flag.verified === false && (
          <span className="ml-auto rounded bg-muted px-1 py-0.5 text-[10px] font-normal normal-case text-muted-foreground">quote not found in transcript</span>
        )}
      </div>
      <p className="mt-0.5">{flag.detail}</p>
      {flag.quote && <p className="mt-0.5 italic text-muted-foreground">Now: “{flag.quote}”</p>}
      {flag.round1Quote && <p className="italic text-muted-foreground">Round 1: “{flag.round1Quote}”</p>}
    </div>
  );
}

function PlanTab({ roundTwoId, plan, covered }: { roundTwoId: string; plan: QuestionPlanItem[]; covered: string[] }) {
  const utils = trpc.useUtils();
  const set = trpc.roundTwo.setCovered.useMutation({ onSuccess: () => void utils.roundTwo.live.invalidate({ id: roundTwoId }) });
  const coveredSet = new Set(covered);
  const done = plan.filter((q) => coveredSet.has(q.id)).length;
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        {done} of {plan.length} covered
      </div>
      {plan.map((q, i) => (
        <label key={q.id} className={cn("flex gap-2 rounded-lg border p-2.5", coveredSet.has(q.id) && "opacity-60")}>
          <Checkbox
            className="mt-0.5"
            checked={coveredSet.has(q.id)}
            onCheckedChange={(v) => set.mutate({ id: roundTwoId, questionId: q.id, covered: v === true })}
          />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">
              Q{i + 1} · {CATEGORY_LABELS[q.category]}
              {q.minutes ? ` · ${q.minutes} min` : ""}
            </div>
            <p className="text-sm">{q.text}</p>
            {q.followUps?.map((f, k) => (
              <p key={k} className="text-xs text-muted-foreground">
                ↳ {f}
              </p>
            ))}
          </div>
        </label>
      ))}
    </div>
  );
}

function TranscriptTab({ live }: { live: LiveData | undefined }) {
  const bottom = useRef<HTMLDivElement>(null);
  const n = live?.transcript.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [n]);
  if (!n) {
    return <p className="text-sm text-muted-foreground">The live transcript appears here once people start talking.</p>;
  }
  return (
    <div className="space-y-2">
      {live!.transcript.map((s) => (
        <div key={s.id as string} className="text-sm">
          <span className={cn("font-semibold", s.speakerRole === "candidate" ? "text-primary" : "text-foreground")}>
            {s.speakerRole === "candidate" ? "Candidate" : (s.speakerName as string) || "Interviewer"}
          </span>
          <span className="ml-1.5 text-[10px] text-muted-foreground">{formatOffset(s.startMs as number)}</span>
          <p>{s.text as string}</p>
        </div>
      ))}
      <div ref={bottom} />
    </div>
  );
}

function formatOffset(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Round1Tab({ ctx }: { ctx: Round1Context }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold">{ctx.overallScore != null ? ctx.overallScore.toFixed(1) : "—"}</span>
        <span className="text-xs text-muted-foreground">round 1 score / 10</span>
      </div>
      {ctx.summary && <p className="whitespace-pre-wrap text-muted-foreground">{ctx.summary}</p>}
      {ctx.strengths?.length ? (
        <div>
          <div className="mb-1 text-xs font-semibold">Strengths</div>
          <ul className="list-disc space-y-0.5 pl-4">{ctx.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      ) : null}
      {ctx.weaknesses?.length ? (
        <div>
          <div className="mb-1 text-xs font-semibold">Weak areas to probe</div>
          <ul className="list-disc space-y-0.5 pl-4">{ctx.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      ) : null}
      {ctx.claims?.length ? (
        <div>
          <div className="mb-1 text-xs font-semibold">Claims to cross-check</div>
          <ul className="space-y-1.5">
            {ctx.claims.map((c, i) => (
              <li key={i} className="rounded-md border p-2">
                <p>{c.claim}</p>
                {c.evidence && <p className="mt-0.5 text-xs italic text-muted-foreground">“{c.evidence}”</p>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!ctx.summary && !ctx.claims?.length && <p className="text-muted-foreground">No round 1 data was found for this candidate.</p>}
    </div>
  );
}

function CvTab({ ctx }: { ctx: Round1Context }) {
  return (
    <div className="space-y-3 text-sm">
      {ctx.skills?.length ? (
        <div className="flex flex-wrap gap-1">
          {ctx.skills.map((s) => (
            <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {s}
            </span>
          ))}
        </div>
      ) : null}
      {ctx.resumeMarkdown ? (
        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{ctx.resumeMarkdown}</pre>
      ) : (
        <p className="text-muted-foreground">No CV text on file.</p>
      )}
    </div>
  );
}

function CompareTab({ live }: { live: LiveData | undefined }) {
  const contradictions = (live?.flags ?? []).filter((f) => f.kind === "contradiction" || f.kind === "possible_assistance");
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        How round 2 answers compare with round 1. These are signals to follow up on, not conclusions.
      </p>
      <StyleTable r1={live?.style.round1 ?? null} r2={live?.style.round2 ?? null} />
      {live?.style.notes.map((n, i) => (
        <p key={i} className="text-xs">
          {n}
        </p>
      ))}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold">Answer consistency</div>
        {contradictions.length ? (
          contradictions.map((f, i) => <FlagCard key={i} flag={f} />)
        ) : (
          <p className="text-xs text-muted-foreground">No contradictions with round 1 so far.</p>
        )}
      </div>
    </div>
  );
}

function NotesTab({ roundTwoId, live }: { roundTwoId: string; live: LiveData | undefined }) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [kind, setKind] = useState<"note" | "chat">("note");
  const add = trpc.roundTwo.addNote.useMutation({
    onSuccess: () => {
      setBody("");
      void utils.roundTwo.live.invalidate({ id: roundTwoId });
    },
    onError: (err) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });
  const items = (live?.notes ?? []).filter((n) => n.kind === kind);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-1">
        {(["note", "chat"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn("rounded-md px-2 py-0.5 text-xs", kind === k ? "bg-muted font-semibold" : "text-muted-foreground")}
          >
            {k === "note" ? "Notes" : "Panel chat"}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-2">
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {kind === "note" ? "Notes are timestamped and feed the copilot and the final report." : "Private chat between panelists. The candidate never sees it."}
          </p>
        )}
        {items.map((n) => (
          <div key={n.id as string} className="rounded-md border p-2 text-sm">
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="font-semibold">{(n.authorName as string) || "Panel"}</span>
              {n.offsetMs != null && <span>{formatOffset(n.offsetMs as number)}</span>}
              {n.visibility === "private" && (
                <span className="inline-flex items-center gap-0.5">
                  <Lock className="h-2.5 w-2.5" /> only you
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap">{n.body as string}</p>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && body.trim()) {
              e.preventDefault();
              add.mutate({ id: roundTwoId, body: body.trim(), visibility: isPrivate ? "private" : "shared", kind });
            }
          }}
          rows={2}
          className="text-sm"
          placeholder={kind === "note" ? "Observation, e.g. 'Hesitated on scaling question'" : "Message the panel"}
        />
        <div className="flex items-center justify-between">
          {kind === "note" ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={isPrivate} onCheckedChange={(v) => setPrivate(v === true)} /> Private
            </label>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            disabled={!body.trim() || add.isLoading}
            onClick={() => add.mutate({ id: roundTwoId, body: body.trim(), visibility: isPrivate ? "private" : "shared", kind })}
          >
            {kind === "note" ? "Add note" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ScorecardTab({
  roundTwoId,
  initial,
  aiScores = null,
}: {
  roundTwoId: string;
  initial: Record<string, unknown> | null;
  /** Live AI suggestions; shown next to each criterion, applied only when the panelist clicks. */
  aiScores?: LiveScores | null;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [scores, setScores] = useState<Record<string, number>>(() => (initial?.scores as Record<string, number>) ?? {});
  const [rec, setRec] = useState<Recommendation | null>(() => (initial?.recommendation as Recommendation | null) ?? null);
  const [comments, setComments] = useState<string>(() => (initial?.comments as string) ?? "");
  const submitted = !!initial?.submittedAt;
  const save = trpc.roundTwo.saveScorecard.useMutation({
    onSuccess: (_, v) => {
      toast({ title: v.submit ? "Scorecard submitted" : "Draft saved" });
      void utils.roundTwo.get.invalidate({ id: roundTwoId });
    },
    onError: (err) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Score independently. Other panelists&apos; scorecards stay hidden until you submit yours.
      </p>
      {RUBRIC.map((r) => {
        const ai = aiScores?.scores.find((c) => c.criterion === r);
        return (
        <div key={r}>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium">
            <span>{r}</span>
            {ai?.score != null && (
              <button
                type="button"
                title={ai.reason || "AI suggestion from the live transcript"}
                onClick={() => setScores({ ...scores, [r]: ai.score as number })}
                className={cn(
                  "rounded-full border border-dashed px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground hover:bg-muted",
                  scores[r] === ai.score && "border-primary/50 text-primary",
                )}
              >
                AI suggests {ai.score}
                {scores[r] == null ? " · use" : ""}
              </button>
            )}
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScores({ ...scores, [r]: n })}
                className={cn(
                  "h-8 w-8 rounded-md border text-sm",
                  scores[r] === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        );
      })}
      <div>
        <div className="mb-1 text-xs font-medium">Recommendation</div>
        <div className="grid grid-cols-3 gap-1">
          {RECOMMENDATIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRec(r)}
              className={cn("rounded-md border px-1.5 py-1 text-xs", rec === r ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {RECOMMENDATION_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={4} placeholder="Overall comments" className="text-sm" />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={save.isLoading} onClick={() => save.mutate({ id: roundTwoId, scores, recommendation: rec, comments, submit: false })}>
          Save draft
        </Button>
        <Button size="sm" disabled={save.isLoading || !rec} onClick={() => save.mutate({ id: roundTwoId, scores, recommendation: rec, comments, submit: true })}>
          {submitted ? "Update submission" : "Submit"}
        </Button>
      </div>
    </div>
  );
}
