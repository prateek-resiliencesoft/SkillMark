"use client";

import { RoundTwoReportView } from "@/components/round-two/report-view";
import { RecommendationBadge, RoundTwoStatusBadge } from "@/components/round-two/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildRoundTabs,
  buildTimeline,
  fmtScore,
  latestRound2,
  nextAction,
  parseRoundParam,
  resolveActiveRound,
  ROUND_QUERY_PARAM,
  withRoundParam,
  type Round1Facts,
  type Round2Facts,
  type RoundNumber,
  type RoundTab,
  type TabTone,
  type TimelineStep,
} from "@/lib/round-details";
import type { RoundTwoReport } from "@/lib/round-two/types";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Circle, Code2, ExternalLink, Loader2, PenTool, Users, Video, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ------------------------------------------------------------------ */
/*  State: rounds of one candidate + which one is shown (?round=)      */
/* ------------------------------------------------------------------ */

function readRoundParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(ROUND_QUERY_PARAM);
}

export interface CandidateRoundsState {
  /** True while the first Round 2 lookup is in flight (Round 1 can still render). */
  loading: boolean;
  tabs: RoundTab[];
  /** All Round 2 attempts, newest first. */
  attempts: Round2Facts[];
  /** Newest Round 2 attempt (drives the default round and the summary). */
  r2: Round2Facts | null;
  r1: Round1Facts;
  active: RoundNumber;
  setActive: (round: RoundNumber) => void;
  /** Round 2 exists, so the switcher is worth showing. */
  hasRound2: boolean;
}

/**
 * Rounds of one candidate and the selected round. The selection lives in `?round=` (replaceState,
 * so no navigation and other params are kept); without it the latest round that is in progress
 * or finished is opened.
 */
export function useCandidateRounds(candidateId: string | null | undefined, r1: Round1Facts): CandidateRoundsState {
  const q = trpc.roundTwo.roundsForCandidate.useQuery(
    { candidateId: candidateId ?? "" },
    {
      enabled: !!candidateId,
      retry: false,
      // Keep the switcher fresh while a round is happening / its report is being built.
      refetchInterval: (data) =>
        data?.some((r) => r.status === "live" || r.status === "scheduled" || r.reportStatus === "pending" || r.reportStatus === "generating")
          ? 15_000
          : false,
    },
  );
  const attempts = useMemo<Round2Facts[]>(() => (q.data ?? []) as Round2Facts[], [q.data]);
  const r2 = useMemo(() => latestRound2(attempts), [attempts]);
  const tabs = useMemo(() => buildRoundTabs(r1, r2), [r1, r2]);

  const [param, setParam] = useState<string | null>(() => readRoundParam());
  // A different candidate (or the panel re-opened) starts from the URL again.
  useEffect(() => {
    setParam(readRoundParam());
  }, [candidateId]);
  useEffect(() => {
    const onPop = () => setParam(readRoundParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Panel closed: don't leave a stale ?round= behind for the next candidate.
  useEffect(() => {
    if (candidateId || !readRoundParam()) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${withRoundParam(window.location.search, null)}${window.location.hash}`);
    setParam(null);
  }, [candidateId]);

  const active = resolveActiveRound(param, tabs, r2);
  const setActive = useCallback((round: RoundNumber) => {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${withRoundParam(window.location.search, round)}${window.location.hash}`);
    setParam(String(round));
  }, []);

  return { loading: q.isLoading && !!candidateId, tabs, attempts, r2, r1, active, setActive, hasRound2: !!r2 };
}

/* ------------------------------------------------------------------ */
/*  Switcher bar: tabs + stage summary + timeline                      */
/* ------------------------------------------------------------------ */

const TONE: Record<TabTone, string> = {
  neutral: "border-muted-foreground/30 text-muted-foreground",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  live: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
};

function TimelineDot({ step }: { step: TimelineStep }) {
  const base = "flex h-4 w-4 items-center justify-center rounded-full border";
  if (step.state === "done") return <span className={cn(base, "border-emerald-500 bg-emerald-500 text-white")}><Check className="h-2.5 w-2.5" /></span>;
  if (step.state === "failed") return <span className={cn(base, "border-destructive bg-destructive text-white")}><X className="h-2.5 w-2.5" /></span>;
  if (step.state === "current") return <span className={cn(base, "border-primary text-primary")}><Circle className="h-2 w-2 fill-current" /></span>;
  return <span className={cn(base, "border-muted-foreground/30 text-muted-foreground/40")} />;
}

export function RoundSwitcher({
  state,
  onBack,
  className,
}: {
  state: CandidateRoundsState;
  /** Optional back link rendered at the left (used where the page has no back button of its own). */
  onBack?: () => void;
  className?: string;
}) {
  const { tabs, active, setActive, r1, r2, loading } = state;
  const next = nextAction(r1, r2);
  const steps = buildTimeline(r1, r2);

  return (
    <div className={cn("space-y-2 border-b bg-background px-5 py-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <Button size="sm" variant="ghost" className="-ml-2 h-8 px-2" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
        )}
        <div role="tablist" aria-label="Interview round" className="inline-flex flex-wrap gap-1.5 rounded-xl bg-muted/50 p-1">
          {tabs.map((t) => {
            const selected = t.round === active;
            return (
              <button
                key={t.round}
                role="tab"
                type="button"
                aria-selected={selected}
                disabled={!t.available}
                onClick={() => setActive(t.round)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition",
                  selected ? "bg-background shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                <span className="flex flex-col leading-tight">
                  <span className={cn("font-medium", selected && "text-foreground")}>
                    {t.label} <span className="font-normal text-muted-foreground">· {t.kind}</span>
                  </span>
                </span>
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", TONE[t.tone])}>
                  {t.status}
                  {t.score ? ` · ${t.score}` : ""}
                </span>
                {t.active && !selected && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-label="Needs attention" />}
              </button>
            );
          })}
          {loading && (
            <span className="flex items-center px-2 text-xs text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Checking Round 2…
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <ArrowRight className="h-3 w-3 text-primary" /> Next: {next.label}
        </span>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground" aria-label="Interview progress">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <TimelineDot step={s} />
              <span className={cn(s.state === "current" && "font-medium text-foreground")}>
                {s.label}
                {s.detail ? ` (${s.detail})` : ""}
              </span>
              {i < steps.length - 1 && <span className="text-muted-foreground/40">›</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Round 2 panel                                                      */
/* ------------------------------------------------------------------ */

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  const date = new Date(d);
  return isNaN(date.getTime())
    ? d
    : date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtDuration(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.round(ms / 60_000);
  return m < 1 ? "<1 min" : `${m} min`;
}

function Section({ title, icon: Icon, children, aside }: { title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
          {title}
        </h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ icon: Icon = Video, title, hint, children }: { icon?: React.ComponentType<{ className?: string }>; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export function RoundTwoPanel({
  state,
  onSchedule,
}: {
  state: CandidateRoundsState;
  /** Opens the schedule sheet (draft / cancelled / no-show). Without it, links to the Round 2 page. */
  onSchedule?: () => void;
}) {
  const { attempts, r2 } = state;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const attempt = attempts.find((a) => a.id === pickedId) ?? r2;
  const id = attempt?.id ?? "";

  const q = trpc.roundTwo.get.useQuery(
    { id },
    {
      enabled: !!id,
      retry: false,
      refetchInterval: (d) =>
        d?.round.reportStatus === "pending" || d?.round.reportStatus === "generating" || d?.round.status === "live" ? 8000 : false,
    },
  );
  const ended = attempt?.status === "ended";
  const subs = trpc.roundTwo.boardSubmissions.useQuery({ id }, { enabled: !!id && (ended || attempt?.status === "live"), retry: false });
  const [showTranscript, setShowTranscript] = useState(false);
  const live = trpc.roundTwo.live.useQuery({ id }, { enabled: !!id && ended && showTranscript, retry: false });
  const [openCode, setOpenCode] = useState<string | null>(null);

  if (state.loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!attempt) {
    return (
      <EmptyState title="No Round 2 yet" hint="Approve the candidate in Round 1, then schedule the live panel interview.">
        {onSchedule && (
          <Button size="sm" onClick={onSchedule}>
            <Video className="mr-1.5 h-3.5 w-3.5" /> Schedule Round 2
          </Button>
        )}
      </EmptyState>
    );
  }

  const round = q.data?.round;
  const report = (round?.report ?? null) as RoundTwoReport | null;
  const reportStatus = round?.reportStatus ?? attempt.reportStatus;
  const status = round?.status ?? attempt.status;
  const joinable = status === "scheduled" || status === "live";
  const scheduledAt = round?.scheduledAt ?? attempt.scheduledAt;
  const duration = fmtDuration(round?.startedAt ?? attempt.startedAt, round?.endedAt ?? attempt.endedAt);
  const participants = q.data?.participants ?? [];
  const scorecards = q.data?.scorecards ?? [];
  const planCount = Array.isArray(round?.questionPlan) ? round!.questionPlan.length : 0;
  const submissions = subs.data ?? [];

  return (
    <div className="space-y-4">
      {attempts.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Attempt</span>
          {[...attempts].reverse().map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setPickedId(a.id)}
              className={cn(
                "rounded-full border px-2.5 py-0.5",
                a.id === attempt.id ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              #{i + 1} · {a.status.replace("_", "-")}
            </button>
          ))}
        </div>
      )}

      <Section
        title={attempt.title || "Round 2 live interview"}
        icon={Video}
        aside={<RoundTwoStatusBadge status={status} />}
      >
        <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Fact label="Scheduled" value={fmtDate(scheduledAt)} />
          <Fact label="Started" value={fmtDate(round?.startedAt ?? attempt.startedAt)} />
          <Fact label="Ended" value={fmtDate(round?.endedAt ?? attempt.endedAt)} />
          <Fact label="Duration" value={duration} />
          <Fact label="Panel" value={participants.length ? `${participants.length} ${participants.length === 1 ? "person" : "people"}` : null} />
          <Fact label="Planned questions" value={planCount ? String(planCount) : null} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {joinable && (
            <Button size="sm" asChild>
              <Link href={`/r2/${id}/room`}>
                <Video className="mr-1.5 h-3.5 w-3.5" /> {status === "live" ? "Rejoin room" : "Start / join room"}
              </Link>
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link href={`/round-two/${id}`}>
              Open Round 2 page <ExternalLink className="ml-1.5 h-3 w-3" />
            </Link>
          </Button>
          {(status === "draft" || status === "cancelled" || status === "no_show") &&
            (onSchedule ? (
              <Button size="sm" onClick={onSchedule}>
                {status === "draft" ? "Continue scheduling" : "Reschedule Round 2"}
              </Button>
            ) : null)}
        </div>
      </Section>

      {q.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Could not load this round: {q.error.message}
        </div>
      )}
      {q.isLoading && <Skeleton className="h-32 w-full" />}

      {/* Outcome by state */}
      {status === "draft" && (
        <EmptyState title="Round 2 is still a draft" hint="The question plan is saved, but the panel and the candidate have not been invited yet." />
      )}
      {status === "scheduled" && (
        <EmptyState icon={Users} title="Waiting for the interview" hint="The report, code submissions and panel feedback appear here once the live round has ended." />
      )}
      {status === "live" && (
        <EmptyState icon={Video} title="Round 2 is happening now" hint="This view updates by itself. Code and feedback show up after the interview ends." />
      )}
      {(status === "cancelled" || status === "no_show") && (
        <EmptyState
          icon={AlertTriangle}
          title={status === "no_show" ? "The candidate did not join" : "This Round 2 was cancelled"}
          hint="Reschedule to create a new attempt. Round 1 results are unchanged."
        />
      )}

      {ended && (
        <>
          {reportStatus === "ready" && report ? (
            <RoundTwoReportView report={report} />
          ) : reportStatus === "failed" ? (
            <EmptyState icon={AlertTriangle} title="The Round 2 report failed to generate" hint="Open the Round 2 page to retry it.">
              <Button size="sm" variant="outline" asChild>
                <Link href={`/round-two/${id}`}>Open Round 2 page</Link>
              </Button>
            </EmptyState>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> The Round 2 report is being generated. This page updates by itself.
            </div>
          )}

          <Section title="Coding & whiteboard" icon={Code2}>
            {subs.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : submissions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No code or drawing was captured in this round.</p>
            ) : (
              <ul className="space-y-2">
                {submissions.map((s) => {
                  const key = `${s.kind}:${s.taskId}`;
                  const open = openCode === key;
                  return (
                    <li key={key} className="rounded-lg border bg-background/60">
                      <div className="flex items-center gap-2 px-3 py-2 text-sm">
                        {s.kind === "coding" ? <Code2 className="h-3.5 w-3.5 text-muted-foreground" /> : <PenTool className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                        {s.language && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{s.language}</span>}
                        <span className="text-[11px] text-muted-foreground">{s.submittedAt ? `Submitted ${fmtDate(s.submittedAt)}` : `Saved ${fmtDate(s.updatedAt)}`}</span>
                        {s.kind === "coding" && s.hasData && (
                          <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setOpenCode(open ? null : key)}>
                            {open ? "Hide code" : "View code"}
                          </button>
                        )}
                      </div>
                      {s.kind === "whiteboard" && <p className="px-3 pb-2 text-[11px] text-muted-foreground">{s.hasData ? "Drawing saved. Open the Round 2 page to view it." : "Nothing drawn."}</p>}
                      {open && (
                        <>
                          {s.prompt && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{s.prompt}</p>}
                          <pre className="code-scrollbar max-h-80 overflow-auto border-t bg-muted/40 p-3 text-xs">{s.data}</pre>
                          {s.truncated && <p className="px-3 pb-2 text-[11px] text-muted-foreground">Shortened. Open the Round 2 page for the full code.</p>}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Panel feedback" icon={Users}>
            {q.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : scorecards.length === 0 ? (
              <p className="text-xs text-muted-foreground">No panel feedback has been submitted yet.</p>
            ) : (
              <ul className="space-y-3">
                {scorecards.map((c) => (
                  <li key={c.id as string} className="rounded-lg border bg-background/60 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{(c.userName as string | null) || "Interviewer"}</span>
                      <RecommendationBadge value={c.recommendation as string | null} />
                      {fmtScore(avgScore(c.scores)) && <span className="text-xs text-muted-foreground">Avg {fmtScore(avgScore(c.scores))}/5</span>}
                    </div>
                    {c.comments ? <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">{c.comments as string}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Transcript"
            aside={
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setShowTranscript((v) => !v)}>
                {showTranscript ? "Hide" : "Show"}
              </button>
            }
          >
            {!showTranscript ? (
              <p className="text-xs text-muted-foreground">Hidden. Show it to read the live conversation.</p>
            ) : live.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (live.data?.transcript.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No transcript was saved for this round.</p>
            ) : (
              <div className="code-scrollbar max-h-80 space-y-1.5 overflow-y-auto rounded-md border p-2 text-xs">
                {live.data!.transcript.map((s) => (
                  <p key={s.id as string}>
                    <span className="font-semibold">{s.speakerRole === "candidate" ? "Candidate" : (s.speakerName as string) || "Interviewer"}:</span> {s.text as string}
                  </p>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2 py-0.5 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1", !value && "text-muted-foreground/60")}>{value || "—"}</span>
    </div>
  );
}

function avgScore(scores: unknown): number | null {
  if (!scores || typeof scores !== "object") return null;
  const v = Object.values(scores as Record<string, unknown>).filter((n): n is number => typeof n === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export { parseRoundParam };
