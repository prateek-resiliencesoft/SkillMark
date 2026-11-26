"use client";

import { DataTableWrapper, EmptyState, TableHeadRow, TableRow, formatWhen } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import type { ErrorLogReport } from "@/lib/error-log-report";
import { CATEGORY_LABELS, type ErrorSeverity } from "@/lib/session-error-log";
import { cn } from "@/lib/utils";
import { ListFilter } from "lucide-react";
import Link from "next/link";

const SEVERITY_STYLES: Record<ErrorSeverity, string> = {
  info: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/10 text-amber-600",
  error: "bg-red-500/10 text-red-600",
  critical: "bg-red-600 text-white",
};

export function ErrorEventsTable({
  events,
  loading,
  onPage,
}: {
  events: ErrorLogReport["events"];
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  if (!loading && events.total === 0) {
    return <EmptyState icon={ListFilter} title="No events" description="No error events match these filters." />;
  }
  const from = events.page * events.pageSize + 1;
  const to = Math.min(events.total, (events.page + 1) * events.pageSize);
  const lastPage = Math.max(0, Math.ceil(events.total / events.pageSize) - 1);

  return (
    <div className="space-y-3">
      <DataTableWrapper tableClassName="table-fixed min-w-[980px]">
        <colgroup>
          <col className="w-[128px]" />
          <col className="w-[88px]" />
          <col className="w-[132px]" />
          <col className="w-[150px]" />
          <col className="w-[140px]" />
          <col className="w-[150px]" />
          <col />
        </colgroup>
        <TableHeadRow>
          <th className="px-3 py-2.5 font-semibold">Time</th>
          <th className="px-3 py-2.5 font-semibold">Severity</th>
          <th className="px-3 py-2.5 font-semibold">Category</th>
          <th className="px-3 py-2.5 font-semibold">Organization</th>
          <th className="px-3 py-2.5 font-semibold">Candidate</th>
          <th className="px-3 py-2.5 font-semibold">Interview</th>
          <th className="px-3 py-2.5 font-semibold">Message</th>
        </TableHeadRow>
        <tbody>
          {events.items.map((e) => (
            <TableRow key={e.id}>
              <td className="whitespace-nowrap px-3 py-2.5 align-middle text-muted-foreground">{formatWhen(e.createdAt)}</td>
              <td className="px-3 py-2.5 align-middle">
                <span
                  className={cn(
                    "inline-flex w-[68px] justify-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                    SEVERITY_STYLES[e.severity],
                  )}
                >
                  {e.severity}
                </span>
              </td>
              <td className="truncate px-3 py-2.5 align-middle text-muted-foreground" title={CATEGORY_LABELS[e.category] ?? e.category}>
                {CATEGORY_LABELS[e.category] ?? e.category}
              </td>
              <td className="truncate px-3 py-2.5 align-middle" title={e.organizationName ?? undefined}>
                {e.organizationId ? (
                  <Link href={`/admin/organizations/${e.organizationId}`} className="text-primary hover:underline">
                    {e.organizationName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Unknown</span>
                )}
              </td>
              <td className="truncate px-3 py-2.5 align-middle" title={e.candidateName ?? undefined}>
                {e.candidateName ?? <span className="text-muted-foreground">Unnamed</span>}
              </td>
              <td className="truncate px-3 py-2.5 align-middle text-muted-foreground" title={e.interviewTitle ?? undefined}>
                {e.interviewTitle ?? "—"}
              </td>
              <td className="px-3 py-2.5 align-middle">
                <p className="line-clamp-2 break-words font-mono text-[11px] leading-snug" title={e.message}>
                  {e.message}
                </p>
              </td>
            </TableRow>
          ))}
        </tbody>
      </DataTableWrapper>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">
          {from}–{to} of {events.total}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={events.page === 0 || loading} onClick={() => onPage(events.page - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="outline" disabled={events.page >= lastPage || loading} onClick={() => onPage(events.page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
