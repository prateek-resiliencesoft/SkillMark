"use client";

import { DataTableWrapper, EmptyState, TableHeadRow, TableRow, formatWhen } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { ErrorGroup, GroupStatus } from "@/lib/error-log-report";
import { CATEGORY_LABELS, type ErrorSeverity } from "@/lib/session-error-log";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

const SEVERITY_STYLES: Record<ErrorSeverity, string> = {
  info: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/10 text-amber-600",
  error: "bg-red-500/10 text-red-600",
  critical: "bg-red-600 text-white",
};

const STATUS_STYLES: Record<GroupStatus, string> = {
  open: "border-red-500/30 bg-red-500/10 text-red-600",
  acknowledged: "border-sky-500/30 bg-sky-500/10 text-sky-600",
  resolved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
};

const STATUS_LABEL: Record<GroupStatus, string> = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved" };

const COLS = 8;

function GroupDetail({ group }: { group: ErrorGroup }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [note, setNote] = useState(group.note ?? "");
  const save = trpc.errorLogs.setGroupStatus.useMutation({
    onSuccess: () => {
      void utils.errorLogs.report.invalidate();
      toast({ title: "Saved" });
    },
    onError: (err) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const act = (status: GroupStatus) => save.mutate({ signature: group.signature, status, note: note.trim() || null });

  return (
    <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
      <div className="space-y-3 text-xs">
        <div>
          <p className="mb-1 font-semibold text-muted-foreground">Organizations ({group.orgCount})</p>
          {group.topOrgs.length ? (
            <ul className="space-y-1">
              {group.topOrgs.map((o) => (
                <li key={o.id ?? "none"} className="flex items-center justify-between gap-2">
                  {o.id ? (
                    <Link href={`/admin/organizations/${o.id}`} className="truncate font-medium text-primary hover:underline">
                      {o.name}
                    </Link>
                  ) : (
                    <span className="truncate text-muted-foreground">{o.name}</span>
                  )}
                  <span className="tabular-nums text-muted-foreground">{o.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">—</p>
          )}
        </div>
        <div>
          <p className="mb-1 font-semibold text-muted-foreground">Candidates ({group.candidateCount})</p>
          <ul className="space-y-1">
            {group.topCandidates.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-2">
                <span className="truncate">{c.name}</span>
                <span className="tabular-nums text-muted-foreground">{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-muted-foreground">
          {group.sessionCount} interview session{group.sessionCount === 1 ? "" : "s"} · first {formatWhen(group.firstSeen)} · last{" "}
          {formatWhen(group.lastSeen)}
        </p>
        <p className="break-all font-mono text-[10px] text-muted-foreground" title="Error group id">
          {group.signature} · {group.source}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Full message</p>
        <p className="break-words rounded-md bg-muted/50 p-2 font-mono text-[11px]">{group.sampleMessage}</p>
        <p className="text-xs font-semibold text-muted-foreground">Note</p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="What was done, or why it is safe to ignore"
          className="text-xs"
        />
        <div className="flex flex-wrap gap-2">
          {group.status !== "acknowledged" && (
            <Button size="sm" variant="outline" disabled={save.isLoading} onClick={() => act("acknowledged")}>
              Acknowledge
            </Button>
          )}
          {group.status !== "resolved" && (
            <Button size="sm" disabled={save.isLoading} onClick={() => act("resolved")}>
              Mark resolved
            </Button>
          )}
          {group.status !== "open" && (
            <Button size="sm" variant="ghost" disabled={save.isLoading} onClick={() => act("open")}>
              Reopen
            </Button>
          )}
          {note.trim() !== (group.note ?? "") && (
            <Button size="sm" variant="ghost" disabled={save.isLoading} onClick={() => act(group.status)}>
              Save note
            </Button>
          )}
        </div>
        {group.statusUpdatedAt && (
          <p className="text-[11px] text-muted-foreground">Status changed {formatWhen(group.statusUpdatedAt)}</p>
        )}
      </div>
    </div>
  );
}

export function ErrorGroupsTable({ groups, loading }: { groups: ErrorGroup[]; loading?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (sig: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sig)) next.delete(sig);
      else next.add(sig);
      return next;
    });

  if (!loading && groups.length === 0) {
    return <EmptyState icon={AlertTriangle} title="No error groups" description="Nothing matches these filters in the selected range." />;
  }

  return (
    <DataTableWrapper>
      <thead>
        <TableHeadRow>
          <th className="px-3 py-2 font-semibold">#</th>
          <th className="px-3 py-2 font-semibold">Error</th>
          <th className="px-3 py-2 font-semibold">Severity</th>
          <th className="px-3 py-2 text-right font-semibold">Count</th>
          <th className="px-3 py-2 text-right font-semibold">Orgs</th>
          <th className="px-3 py-2 text-right font-semibold">Candidates</th>
          <th className="px-3 py-2 font-semibold">Last seen</th>
          <th className="px-3 py-2 font-semibold">Status</th>
        </TableHeadRow>
      </thead>
      <tbody>
        {groups.map((g, i) => {
          const expanded = open.has(g.signature);
          const Chevron = expanded ? ChevronDown : ChevronRight;
          return (
            <Fragment key={g.signature}>
              <TableRow onClick={() => toggle(g.signature)} className="cursor-pointer">
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                <td className="max-w-[420px] px-3 py-2">
                  <div className="flex items-start gap-2">
                    <Chevron className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 space-y-1">
                      <p className="line-clamp-2 break-words font-mono text-[11px]">{g.sampleMessage}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {CATEGORY_LABELS[g.category] ?? g.category}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{g.source}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", SEVERITY_STYLES[g.severity])}>{g.severity}</span>
                </td>
                <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">{g.count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.orgCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.candidateCount}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatWhen(g.lastSeen)}</td>
                <td className="px-3 py-2">
                  <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", STATUS_STYLES[g.status])}>
                    {STATUS_LABEL[g.status]}
                  </span>
                </td>
              </TableRow>
              {expanded && (
                <tr className="bg-muted/20">
                  <td colSpan={COLS} className="p-0">
                    <GroupDetail group={g} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </DataTableWrapper>
  );
}
