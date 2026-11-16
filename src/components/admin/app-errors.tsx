"use client";

import { formatWhen } from "@/components/admin/admin-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/** Errors the app recorded in its own database. Used when Grafana logs are down. */
export function AppErrors({ minutes, search }: { minutes: number; search?: string }) {
  const q = trpc.platformOps.appErrors.useQuery(
    { minutes: Math.max(minutes, 60), limit: 150, search: search || undefined },
    { staleTime: 15_000 },
  );
  if (q.isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  const rows = q.data?.entries ?? [];
  if (q.data?.error || q.error) {
    return <p className="p-4 text-xs text-muted-foreground">App errors unavailable: {q.data?.error ?? q.error?.message}</p>;
  }
  if (!rows.length) {
    return <p className="p-4 text-xs text-muted-foreground">No app errors recorded in this window.</p>;
  }
  return (
    <ul className="divide-y font-mono text-[11px] leading-relaxed sm:text-xs">
      {rows.map((r) => (
        <li key={r.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[7.5rem_5rem_9rem_1fr] sm:gap-3">
          <time className="text-muted-foreground tabular-nums">{formatWhen(r.createdAt)}</time>
          <span
            className={cn(
              "w-fit rounded px-1.5",
              r.severity === "critical" || r.severity === "error"
                ? "bg-red-500/10 text-red-600"
                : r.severity === "warning"
                  ? "bg-amber-500/10 text-amber-600"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {r.severity}
          </span>
          <span className="truncate text-muted-foreground" title={r.source}>
            {r.category} · {r.source}
          </span>
          <span className="break-words">
            {r.message}
            {r.status ? ` (${r.status})` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
