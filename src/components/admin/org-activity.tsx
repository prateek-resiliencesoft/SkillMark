"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { QuitEarlyBadge } from "@/components/candidates/quit-early-badge";
import {
  EmptyState,
  Panel,
  StatusPill,
  TacticalButton,
  formatWhen,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Activity,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Mail,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

type Tab = "sessions" | "interviews" | "invited";
const STATUS_FILTERS = ["ALL", "IN_PROGRESS", "COMPLETED", "ABANDONED", "DISQUALIFIED"] as const;

function minutes(sec: number | null) {
  if (!sec) return "—";
  const m = Math.round(sec / 60);
  return m < 1 ? "<1 min" : `${m}m`;
}

function reportLabel(status: string | null, hasReport: boolean) {
  if (hasReport || status === "READY") return "Ready";
  if (status === "PENDING" || status === "GENERATING") return "Generating";
  if (status === "FAILED") return "Failed";
  return "None";
}

export function OrgActivity({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("sessions");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [viewId, setViewId] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);

  const q = trpc.platformOps.orgActivity.useQuery(
    { orgId },
    {
      staleTime: 10_000,
      refetchInterval: (d) =>
        d?.sessions.some(
          (s) =>
            s.status === "IN_PROGRESS" ||
            s.reportStatus === "PENDING" ||
            s.reportStatus === "GENERATING",
        )
          ? 15_000
          : false,
    },
  );
  const detail = trpc.platformOps.sessionDetail.useQuery(
    { sessionId: viewId ?? "" },
    { enabled: !!viewId },
  );

  const done = (title: string) => {
    toast({ title });
    void utils.platformOps.orgActivity.invalidate({ orgId });
    if (viewId) void utils.platformOps.sessionDetail.invalidate({ sessionId: viewId });
  };
  const fail = (e: { message: string }) =>
    toast({ title: "Operation failed", description: e.message, variant: "destructive" });

  const close = trpc.platformOps.closeSession.useMutation({
    onSuccess: (r) => {
      setCloseId(null);
      done(`Session finalized as ${r.status.toLowerCase().replace("_", " ")}`);
    },
    onError: fail,
  });
  const regen = trpc.platformOps.regenerateReport.useMutation({
    onSuccess: () => done("Assessment evaluation queued for generation"),
    onError: fail,
  });
  const newLink = trpc.platformOps.sendNewLink.useMutation({
    onSuccess: (r) => {
      const sent = Object.entries(r.delivery ?? {})
        .filter(([, v]) => v?.status === "sent")
        .map(([k]) => k);
      done(
        sent.length
          ? `Invitation dispatched via ${sent.join(" and ")}`
          : "Fresh invite token generated",
      );
    },
    onError: fail,
  });

  const term = search.trim().toLowerCase();
  const sessions = useMemo(
    () =>
      (q.data?.sessions ?? []).filter(
        (s) =>
          (status === "ALL" || s.status === status) &&
          (!term ||
            `${s.name} ${s.email ?? ""} ${s.interviewTitle}`
              .toLowerCase()
              .includes(term)),
      ),
    [q.data, status, term],
  );
  const interviews = (q.data?.interviews ?? []).filter(
    (i) => !term || i.title.toLowerCase().includes(term),
  );
  const invited = (q.data?.pendingCandidates ?? []).filter(
    (c) =>
      !term ||
      `${c.name} ${c.email ?? ""} ${c.interviewTitle}`.toLowerCase().includes(term),
  );

  const counts = {
    sessions: q.data?.sessions.length ?? 0,
    interviews: q.data?.interviews.length ?? 0,
    invited: q.data?.pendingCandidates.length ?? 0,
  };

  return (
    <Panel
      kicker="Candidate Activity"
      title="Interviews & Assessment Sessions"
      description="Live examination feeds, completed session transcripts, and pending invitations."
      contentClassName="space-y-4"
    >
      {/* Controls Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Tab Selector */}
          <div className="flex items-center rounded-lg border border-border/80 bg-muted/40 p-0.5 dark:border-white/[0.08] dark:bg-zinc-900/80">
            {(["sessions", "interviews", "invited"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-semibold capitalize transition-all duration-150 active:scale-95",
                  tab === t
                    ? "bg-primary text-white shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "invited" ? "Awaiting Start" : t}{" "}
                <span className="font-mono text-[10px] opacity-70">({counts[t]})</span>
              </button>
            ))}
          </div>

          <div className="relative min-w-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter candidate or role…"
              className="h-8 pl-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
            />
          </div>
        </div>

        {tab === "sessions" ? (
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-all active:scale-95",
                  status === s
                    ? "border-primary bg-primary/10 text-primary dark:text-white"
                    : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "ALL" ? "All" : s.replace("_", " ").toLowerCase()}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Content Rendering */}
      {q.isLoading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : q.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-medium text-rose-500">
          Telemetry stream error: {q.error.message}
        </div>
      ) : tab === "sessions" ? (
        sessions.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="No candidate sessions found"
            description="No sessions match the current search or status filters."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/40">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:border-white/[0.06] dark:bg-zinc-900/60">
                <tr>
                  <th className="px-4 py-2.5">Candidate</th>
                  <th className="px-4 py-2.5">Interview Template</th>
                  <th className="px-4 py-2.5">State</th>
                  <th className="px-4 py-2.5">Report</th>
                  <th className="px-4 py-2.5">Duration</th>
                  <th className="px-4 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 dark:divide-white/[0.04]">
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className="transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{s.name}</p>
                      {s.email ? (
                        <p className="font-mono text-[11px] text-muted-foreground">{s.email}</p>
                      ) : null}
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">
                      {s.interviewTitle}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={s.status} />
                        <QuitEarlyBadge session={s} />
                        {s.live ? (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-bold text-emerald-500 uppercase animate-pulse">
                            Live
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground">
                        {reportLabel(s.reportStatus, s.hasReport)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                      {minutes(s.durationSeconds)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-muted-foreground">
                      {formatWhen(s.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <TacticalButton
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => setViewId(s.id)}
                        >
                          <Eye className="h-3 w-3" />
                          <span>Inspect</span>
                        </TacticalButton>

                        {s.status === "IN_PROGRESS" ? (
                          <TacticalButton
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-rose-500 hover:text-rose-600"
                            onClick={() => setCloseId(s.id)}
                          >
                            Close
                          </TacticalButton>
                        ) : (
                          <TacticalButton
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            disabled={regen.isPending}
                            onClick={() => regen.mutate({ sessionId: s.id })}
                          >
                            <Sparkles className="h-3 w-3 text-primary" />
                            <span>{s.hasReport ? "Redo" : "Score"}</span>
                          </TacticalButton>
                        )}

                        {s.candidateId && s.status === "ABANDONED" ? (
                          <TacticalButton
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={newLink.isPending}
                            onClick={() => newLink.mutate({ candidateId: s.candidateId! })}
                          >
                            Re-invite
                          </TacticalButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === "interviews" ? (
        interviews.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No interviews found"
            description="No interview funnels created in this organization yet."
          />
        ) : (
          <ul className="divide-y divide-border/50 rounded-xl border border-border/70 overflow-hidden dark:divide-white/[0.05] dark:border-white/[0.08]">
            {interviews.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-2 p-3.5 transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate font-heading text-sm font-semibold text-foreground">
                    {i.title}
                  </p>
                  <p className="text-muted-foreground font-mono text-[11px]">
                    Created {formatWhen(i.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-muted-foreground">
                    {i.sessions} total sessions · {i.completed} completed
                    {i.live ? (
                      <span className="ml-1 text-emerald-500 font-bold">({i.live} live)</span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-semibold uppercase",
                      i.isActive
                        ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                        : "border border-border/60 bg-muted text-muted-foreground",
                    )}
                  >
                    {i.isActive ? "Accepting" : "Closed"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : invited.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No candidates waiting"
          description="There are no pending candidate invitations in this organization."
        />
      ) : (
        <ul className="divide-y divide-border/50 rounded-xl border border-border/70 overflow-hidden dark:divide-white/[0.05] dark:border-white/[0.08]">
          {invited.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-2 p-3.5 transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between text-xs"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate font-heading text-sm font-semibold text-foreground">
                  {c.name}
                </p>
                <p className="text-muted-foreground font-mono text-[11px]">
                  {c.email ?? "No email"} · Template: {c.interviewTitle}
                </p>
              </div>
              <span className="font-mono text-muted-foreground text-[11px]">
                Invited {formatWhen(c.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Close Session Confirmation */}
      <ConfirmAction
        open={!!closeId}
        onOpenChange={(o) => !o && setCloseId(null)}
        title="Forcibly close candidate session?"
        description="The candidate's active WebRTC connection will be terminated immediately. If they answered questions, a report will be synthesized; otherwise the session is marked as abandoned."
        confirmLabel="Close Session"
        destructive
        pending={close.isPending}
        onConfirm={() => closeId && close.mutate({ sessionId: closeId })}
      />

      {/* Inspect Session Dialog */}
      <Dialog open={!!viewId} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border-border/70 dark:border-white/[0.1] dark:bg-zinc-950">
          <DialogHeader>
            <DialogTitle className="font-heading text-lg font-bold text-foreground">
              {detail.data?.name ?? "Candidate Session Details"}
            </DialogTitle>
            <DialogDescription className="text-xs font-mono text-muted-foreground">
              {detail.data ? `${detail.data.interviewTitle} · Conducted ${formatWhen(detail.data.createdAt)}` : "Loading session telemetry…"}
            </DialogDescription>
          </DialogHeader>

          {detail.isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </div>
          ) : detail.error ? (
            <p className="text-xs text-destructive">{detail.error.message}</p>
          ) : detail.data ? (
            <div className="space-y-5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={detail.data.status} />
                <QuitEarlyBadge session={detail.data} />
                <span className="font-mono text-muted-foreground text-[11px]">
                  {minutes(detail.data.durationSeconds)} duration · {detail.data.messages.length} messages exchanged
                </span>
              </div>

              {detail.data.reportError ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-500 font-mono text-[11px]">
                  Report Error: {detail.data.reportError}
                </div>
              ) : null}

              {/* Summary */}
              <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3.5 dark:border-white/[0.05]">
                <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider">
                  AI Assessment Summary
                </h4>
                <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground font-sans">
                  {detail.data.summary || "No synthesized assessment report available yet."}
                </p>
                {detail.data.themes.length ? (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {detail.data.themes.map((t) => (
                      <span
                        key={t}
                        className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Transcript */}
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider">
                  Session Transcript
                </h4>
                {detail.data.messages.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No audio messages recorded.</p>
                ) : (
                  <ul className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                    {detail.data.messages.map((m) => (
                      <li
                        key={m.id}
                        className={cn(
                          "rounded-lg p-2.5 text-xs leading-relaxed border",
                          m.role === "USER"
                            ? "border-primary/20 bg-primary/[0.04]"
                            : "border-border/60 bg-muted/40 dark:border-white/[0.04]",
                        )}
                      >
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                          {m.role === "USER" ? "Candidate" : "Interviewer Avatar"} ·{" "}
                          {new Date(m.timestamp).toLocaleTimeString()}
                        </p>
                        <p className="whitespace-pre-wrap text-foreground/90 font-sans">
                          {m.content}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Modal Actions */}
              <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3 dark:border-white/[0.06] justify-end">
                {detail.data.status === "IN_PROGRESS" ? (
                  <TacticalButton
                    size="sm"
                    variant="outline"
                    className="text-rose-500 hover:text-rose-600 text-xs"
                    onClick={() => setCloseId(detail.data!.id)}
                  >
                    Close Session
                  </TacticalButton>
                ) : (
                  <TacticalButton
                    size="sm"
                    loading={regen.isPending}
                    onClick={() => regen.mutate({ sessionId: detail.data!.id })}
                    className="text-xs gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{detail.data.hasReport ? "Regenerate Scorecard" : "Generate Scorecard"}</span>
                  </TacticalButton>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
