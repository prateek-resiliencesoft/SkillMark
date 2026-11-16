"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import {
  EmptyState,
  FilterBar,
  PageHeader,
  StatusPill,
  TacticalButton,
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
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Building2,
  ExternalLink,
  Layers,
  Pause,
  Play,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

export default function AdminOrganizationsPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "ACTIVE" | "SUSPENDED" | "DELETED"
  >("all");
  const [pauseTarget, setPauseTarget] = useState<{
    id: string;
    name: string;
    paused: boolean;
  } | null>(null);

  const settings = trpc.platform.getSettings.useQuery(undefined, {
    staleTime: 30_000,
  });
  const planOptions = (settings.data?.planCatalog ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const list = trpc.platform.listOrganizations.useQuery(
    {
      query: deferredQuery || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 50,
    },
    { staleTime: 10_000 },
  );

  const setStatus = trpc.platform.setOrganizationStatus.useMutation({
    onSuccess: (data) => {
      toast({
        title:
          data.status === "SUSPENDED"
            ? "Organization suspended"
            : "Organization resumed",
      });
      setPauseTarget(null);
      utils.platform.listOrganizations.invalidate();
      utils.platform.overview.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) => {
      toast({
        title: "Could not update organization",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const setPlan = trpc.platform.setOrganizationPlan.useMutation({
    onSuccess: (data) => {
      toast({ title: `Plan updated to ${data.planLabel}` });
      utils.platform.listOrganizations.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) => {
      toast({
        title: "Could not update plan",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        kicker="Tenant Management"
        title="Organizations"
        description="Configure tenant spaces, member quotas, subscription plan tiers, and tenant state controls."
      />

      {/* Filter Bar */}
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Filter by organization name or slug…"
        resultCount={list.data?.total}
        onClear={() => {
          setQuery("");
          setStatusFilter("all");
        }}
      >
        <Select
          value={statusFilter}
          onValueChange={(v) =>
            setStatusFilter(v as "all" | "ACTIVE" | "SUSPENDED" | "DELETED")
          }
        >
          <SelectTrigger className="h-9 w-[150px] text-xs font-medium border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active only</SelectItem>
            <SelectItem value="SUSPENDED">Paused / Suspended</SelectItem>
            <SelectItem value="DELETED">Removed</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {/* List Container */}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/50 dark:backdrop-blur-md">
        {list.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : (list.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No organizations found"
            description={
              query || statusFilter !== "all"
                ? "No tenants matched your filter criteria. Try resetting your search."
                : "No organizations exist on this instance yet."
            }
            action={
              query || statusFilter !== "all" ? (
                <TacticalButton
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("all");
                  }}
                >
                  Clear Filters
                </TacticalButton>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border/50 dark:divide-white/[0.05]">
            {(list.data?.items ?? []).map((org) => {
              const paused = org.status === "SUSPENDED";
              const removed = org.status === "DELETED";
              const busy =
                (setStatus.isPending && setStatus.variables?.id === org.id) ||
                (setPlan.isPending && setPlan.variables?.id === org.id);

              return (
                <li
                  key={org.id}
                  className="flex flex-col gap-4 p-4 transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    {/* Org Icon / Monogram */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 font-heading text-sm font-bold text-foreground dark:border-white/[0.08] dark:bg-zinc-900">
                      {org.name.slice(0, 2).toUpperCase()}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/organizations/${org.id}`}
                          className="truncate font-heading text-sm font-bold text-foreground hover:text-primary transition-colors"
                        >
                          {org.name}
                        </Link>

                        <StatusPill
                          status={org.status}
                          label={org.statusLabel}
                          pulse={org.status === "ACTIVE"}
                        />

                        <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase text-muted-foreground dark:border-white/[0.06]">
                          {org.planLabel}
                        </span>
                      </div>

                      <p className="truncate text-xs text-muted-foreground flex items-center gap-2">
                        <span className="font-mono text-muted-foreground/80">{org.slug}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
                        </span>
                        {org.owner ? (
                          <>
                            <span>•</span>
                            <span className="truncate">
                              Owner: {org.owner.name || org.owner.email}
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>

                  {/* Actions & Plan Modifier */}
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    {!removed ? (
                      <>
                        <Select
                          value={org.plan}
                          disabled={busy || planOptions.length === 0}
                          onValueChange={(plan) =>
                            setPlan.mutate({
                              id: org.id,
                              plan,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-[130px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="text-xs">
                            {planOptions.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <TacticalButton
                          size="sm"
                          variant={paused ? "default" : "outline"}
                          disabled={busy}
                          className="h-8 text-xs gap-1.5"
                          onClick={() =>
                            setPauseTarget({
                              id: org.id,
                              name: org.name,
                              paused,
                            })
                          }
                        >
                          {paused ? (
                            <>
                              <Play className="h-3 w-3 fill-current" />
                              <span>Resume</span>
                            </>
                          ) : (
                            <>
                              <Pause className="h-3 w-3" />
                              <span>Pause</span>
                            </>
                          )}
                        </TacticalButton>
                      </>
                    ) : null}

                    <TacticalButton asChild size="sm" variant="ghost" className="h-8 text-xs">
                      <Link href={`/admin/organizations/${org.id}`} className="gap-1.5">
                        <span>Inspect</span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    </TacticalButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Confirmation Dialog */}
      <ConfirmAction
        open={Boolean(pauseTarget)}
        onOpenChange={(open) => {
          if (!open) setPauseTarget(null);
        }}
        title={
          pauseTarget?.paused
            ? `Resume “${pauseTarget.name}”?`
            : `Pause “${pauseTarget?.name ?? ""}”?`
        }
        description={
          pauseTarget?.paused
            ? "Members can immediately access and conduct interviews in this organization again."
            : "Members keep their data and history, but cannot start new interviews or modify configurations until resumed."
        }
        confirmLabel={
          pauseTarget?.paused ? "Resume organization" : "Pause organization"
        }
        pending={setStatus.isPending}
        onConfirm={() => {
          if (!pauseTarget) return;
          setStatus.mutate({
            id: pauseTarget.id,
            status: pauseTarget.paused ? "ACTIVE" : "SUSPENDED",
          });
        }}
      />
    </div>
  );
}
