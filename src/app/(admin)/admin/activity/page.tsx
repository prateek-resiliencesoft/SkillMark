"use client";

import { adminActionLabel } from "@/lib/admin-actions";
import {
  EmptyState,
  FilterBar,
  PageHeader,
  TacticalButton,
  formatWhen,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import {
  Activity,
  ArrowRight,
  Building2,
  ExternalLink,
  History,
  Shield,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

function metaBits(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.name === "string") parts.push(meta.name);
  if (typeof meta.email === "string") parts.push(meta.email);
  if (typeof meta.plan === "string") {
    parts.push(String(meta.plan).replace(/_/g, " ").toLowerCase());
  }
  if (typeof meta.role === "string") parts.push(String(meta.role));
  if (meta.limits && typeof meta.limits === "object") {
    parts.push("custom limits");
  }
  return parts.join(" · ");
}

export default function AdminActivityPage() {
  const [filter, setFilter] = useState<"all" | "org" | "user" | "member">("all");

  const audit = trpc.platform.recentAudit.useQuery(
    {
      limit: 80,
      actionPrefix:
        filter === "org"
          ? "org."
          : filter === "user"
            ? "user."
            : filter === "member"
              ? "org.member."
              : undefined,
    },
    { staleTime: 10_000 },
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        kicker="Governance"
        title="Administrative Audit Trail"
        description="Chronological ledger of privileged operator interventions, tenant status transitions, role escalations, and configuration mutations."
      />

      {/* Filter Control */}
      <FilterBar
        resultCount={(audit.data ?? []).length}
        onClear={() => setFilter("all")}
      >
        <Select
          value={filter}
          onValueChange={(v) =>
            setFilter(v as "all" | "org" | "user" | "member")
          }
        >
          <SelectTrigger className="h-9 w-[180px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80" aria-label="Filter activity">
            <SelectValue placeholder="Action Scope" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All Action Scopes</SelectItem>
            <SelectItem value="org">Organization Events</SelectItem>
            <SelectItem value="user">User & Profile Events</SelectItem>
            <SelectItem value="member">Membership Events</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {/* Audit Log Stream */}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/50 dark:backdrop-blur-md">
        {audit.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : (audit.data ?? []).length === 0 ? (
          <EmptyState
            icon={History}
            title="No recorded audit actions"
            description="Administrative actions and security changes will appear here in real-time."
          />
        ) : (
          <ul className="divide-y divide-border/50 dark:divide-white/[0.05]">
            {(audit.data ?? []).map((row) => {
              const bits = metaBits(row.meta);
              const href =
                row.targetType === "organization" && row.targetId
                  ? `/admin/organizations/${row.targetId}`
                  : row.targetType === "user" && row.targetId
                    ? `/admin/people/${row.targetId}`
                    : null;

              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-primary dark:border-white/[0.08] dark:bg-zinc-900">
                      {row.targetType === "organization" ? (
                        <Building2 className="h-4 w-4" />
                      ) : (
                        <Users className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate font-heading text-sm font-semibold text-foreground">
                        {adminActionLabel(row.action)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground flex items-center gap-1.5">
                        <span className="font-semibold text-foreground/80">{row.actorName}</span>
                        {bits ? <span>• {bits}</span> : null}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatWhen(row.createdAt)}
                    </span>

                    {href ? (
                      <TacticalButton asChild size="sm" variant="ghost" className="h-7 text-xs gap-1">
                        <Link href={href}>
                          <span>Inspect Target</span>
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </TacticalButton>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
