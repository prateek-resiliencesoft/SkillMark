"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { Panel, StatusPill, formatWhen } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useMemo, useState } from "react";

type Tab = "sessions" | "interviews" | "invited";
const STATUS_FILTERS = ["ALL", "IN_PROGRESS", "COMPLETED", "ABANDONED", "DISQUALIFIED"] as const;

function minutes(sec: number | null) {
  if (!sec) return "—";
  const m = Math.round(sec / 60);
  return m < 1 ? "<1 min" : `${m} min`;
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
      refetchInterval: (d) => (d?.sessions.some((s) => s.status === "IN_PROGRESS" || s.reportStatus === "PENDING" || s.reportStatus === "GENERATING") ? 15_000 : false),
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
  const fail = (e: { message: string }) => toast({ title: "Could not do that", description: e.message, variant: "destructive" });

  const close = trpc.platformOps.closeSession.useMutation({
    onSuccess: (r) => {
      setCloseId(null);
      done(`Session closed as ${r.status.toLowerCase().replace("_", " ")}`);
    },
    onError: fail,
  });
  const regen = trpc.platformOps.regenerateReport.useMutation({
    onSuccess: () => done("Report is being generated"),
    onError: fail,
  });
  const newLink = trpc.platformOps.sendNewLink.useMutation({
    onSuccess: (r) => {
      const sent = Object.entries(r.delivery ?? {})
        .filter(([, v]) => v?.status === "sent")
        .map(([k]) => k);
      done(sent.length ? `New link sent by ${sent.join(" and ")}` : "New link created (not sent; copy it from the interview page)");
    },
    onError: fail,
  });

  const term = search.trim().toLowerCase();
  const sessions = useMemo(
    () =>
      (q.data?.sessions ?? []).filter(
        (s) =>
          (status === "ALL" || s.status === status) &&
          (!term || `${s.name} ${s.email ?? ""} ${s.interviewTitle}`.toLowerCase().includes(term)),
      ),
    [q.data, status, term],
  );
  const interviews = (q.data?.interviews ?? []).filter((i) => !term || i.title.toLowerCase().includes(term));
  const invited = (q.data?.pendingCandidates ?? []).filter(
    (c) => !term || `${c.name} ${c.email ?? ""} ${c.interviewTitle}`.toLowerCase().includes(term),
  );

  const counts = {
    sessions: q.data?.sessions.length ?? 0,
    interviews: q.data?.interviews.length ?? 0,
    invited: q.data?.pendingCandidates.length ?? 0,
  };

  return (
    <Panel
      title="Interviews and sessions"
      description="Everything candidates did in this organization. Latest first."
      contentClassName="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5">
          {(["sessions", "interviews", "invited"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium capitalize",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "invited" ? "Invited, not started" : t} ({counts[t]})
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or interview"
          className="h-8 w-56 text-xs"
        />
        {tab === "sessions" ? (
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px]",
                  status === s ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                )}
              >
                {s === "ALL" ? "All" : s.replace("_", " ").toLowerCase()}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{q.error.message}</p>
      ) : tab === "sessions" ? (
        sessions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No sessions.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Candidate</th>
                  <th className="px-3 py-2 font-medium">Interview</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Report</th>
                  <th className="px-3 py-2 font-medium">Length</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sessions.map((s) => (
                  <tr key={s.id} className="align-middle">
                    <td className="px-3 py-2">
                      <p className="font-medium">{s.name}</p>
                      {s.email ? <p className="text-xs text-muted-foreground">{s.email}</p> : null}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">{s.interviewTitle}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={s.status} />
                        {s.live ? <Badge variant="outline" className="border-green-500/40 text-[10px] text-green-600">Live</Badge> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{reportLabel(s.reportStatus, s.hasReport)}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{minutes(s.durationSeconds)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatWhen(s.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewId(s.id)}>
                          View
                        </Button>
                        {s.status === "IN_PROGRESS" ? (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setCloseId(s.id)}>
                            Close
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={regen.isLoading}
                            onClick={() => regen.mutate({ sessionId: s.id })}
                          >
                            {s.hasReport ? "Redo report" : "Make report"}
                          </Button>
                        )}
                        {s.candidateId && s.status === "ABANDONED" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={newLink.isLoading}
                            onClick={() => newLink.mutate({ candidateId: s.candidateId! })}
                          >
                            New link
                          </Button>
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
          <p className="py-6 text-center text-sm text-muted-foreground">No interviews.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {interviews.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.title}</p>
                  <p className="text-xs text-muted-foreground">Created {formatWhen(i.createdAt)}</p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {i.sessions} sessions · {i.completed} completed{i.live ? ` · ${i.live} live` : ""}
                </span>
                <Badge variant="outline" className="text-[10px]">{i.isActive ? "Open" : "Closed"}</Badge>
              </li>
            ))}
          </ul>
        )
      ) : invited.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nobody waiting to start.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {invited.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.email ?? "No email"} · {c.interviewTitle}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">Invited {formatWhen(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmAction
        open={!!closeId}
        onOpenChange={(o) => !o && setCloseId(null)}
        title="Close this session?"
        description="The candidate's link stops working. It is saved as completed if the interviewer had already finished, otherwise as abandoned, and a report is made."
        confirmLabel="Close session"
        destructive
        pending={close.isLoading}
        onConfirm={() => closeId && close.mutate({ sessionId: closeId })}
      />

      <Dialog open={!!viewId} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail.data?.name ?? "Session"}</DialogTitle>
            <DialogDescription>
              {detail.data ? `${detail.data.interviewTitle} · ${formatWhen(detail.data.createdAt)}` : "Loading"}
            </DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : detail.error ? (
            <p className="text-sm text-destructive">{detail.error.message}</p>
          ) : detail.data ? (
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={detail.data.status} />
                <span className="text-xs text-muted-foreground">
                  {minutes(detail.data.durationSeconds)} · {detail.data.messages.length} messages · report{" "}
                  {reportLabel(detail.data.reportStatus, detail.data.hasReport).toLowerCase()}
                </span>
              </div>
              {detail.data.reportError ? (
                <p className="rounded-md bg-destructive/5 p-2 text-xs text-destructive">Last report error: {detail.data.reportError}</p>
              ) : null}
              <section className="space-y-1">
                <h3 className="font-medium">Summary</h3>
                <p className="whitespace-pre-wrap text-muted-foreground">{detail.data.summary || "No report yet."}</p>
                {detail.data.themes.length ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {detail.data.themes.map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                ) : null}
              </section>
              <section className="space-y-2">
                <h3 className="font-medium">Transcript</h3>
                {detail.data.messages.length === 0 ? (
                  <p className="text-muted-foreground">No messages.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.data.messages.map((m) => (
                      <li key={m.id} className={cn("rounded-lg p-2", m.role === "USER" ? "bg-primary/5" : "bg-muted/50")}>
                        <p className="text-[11px] font-medium text-muted-foreground">
                          {m.role === "USER" ? "Candidate" : "Interviewer"} · {new Date(m.timestamp).toLocaleTimeString()}
                        </p>
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {detail.data.status === "IN_PROGRESS" ? (
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCloseId(detail.data!.id)}>
                    Close session
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={regen.isLoading} onClick={() => regen.mutate({ sessionId: detail.data!.id })}>
                    {detail.data.hasReport ? "Regenerate report" : "Generate report"}
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
