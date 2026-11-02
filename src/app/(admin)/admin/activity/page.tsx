"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";

function actionLabel(action: string): string {
  switch (action) {
    case "org.pause":
      return "Paused an organization";
    case "org.resume":
      return "Resumed an organization";
    case "org.set_plan":
      return "Changed a plan";
    default:
      return action.replace(/\./g, " ");
  }
}

export default function AdminActivityPage() {
  const audit = trpc.platform.recentAudit.useQuery(
    { limit: 50 },
    { staleTime: 10_000 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Activity
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A record of admin changes across the instance.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border">
        {audit.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (audit.data ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nothing here yet. Admin actions will appear as they happen.
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
                    {actionLabel(row.action)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.actorName}
                    {typeof row.meta?.name === "string"
                      ? ` · ${row.meta.name}`
                      : ""}
                    {typeof row.meta?.plan === "string"
                      ? ` · ${String(row.meta.plan).replace(/_/g, " ").toLowerCase()}`
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
    </div>
  );
}
