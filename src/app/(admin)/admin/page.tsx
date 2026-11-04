"use client";

import { adminActionLabel } from "@/lib/admin-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import Link from "next/link";

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-xl border bg-card/60 p-5 backdrop-blur-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-heading text-3xl font-semibold tracking-tight",
          tone === "warn" && Number(value) > 0 && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export default function AdminOverviewPage() {
  const overview = trpc.platform.overview.useQuery(undefined, {
    staleTime: 15_000,
  });
  const audit = trpc.platform.recentAudit.useQuery(
    { limit: 8 },
    { staleTime: 15_000 },
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A quiet look across every organization on this ResilienceSoft Interview instance.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/organizations">Manage organizations</Link>
        </Button>
      </div>

      {overview.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Organizations"
            value={overview.data?.organizations ?? 0}
            hint="Active and paused"
          />
          <Stat
            label="Paused"
            value={overview.data?.paused ?? 0}
            hint="Members can view, not change"
            tone="warn"
          />
          <Stat
            label="People"
            value={overview.data?.people ?? 0}
            hint="Everyone with an account"
          />
          <Stat
            label="Live sessions"
            value={overview.data?.liveSessions ?? 0}
            hint="Interviews in progress"
          />
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent activity</h2>
          <Link
            href="/admin/activity"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        </div>

        <div className="overflow-hidden rounded-xl border">
          {audit.isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (audit.data ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No admin actions yet. Pausing or changing a plan will show up
              here.
            </p>
          ) : (
            <ul className="divide-y">
              {(audit.data ?? []).map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {adminActionLabel(row.action)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.actorName}
                      {typeof row.meta?.name === "string"
                        ? ` · ${row.meta.name}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {new Date(row.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
