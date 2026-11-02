"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useDeferredValue, useState } from "react";

const PLAN_OPTIONS = [
  { value: "FREE", label: "Free" },
  { value: "PRO", label: "Pro" },
  { value: "ENTERPRISE", label: "Enterprise" },
  { value: "SELF_HOSTED", label: "Self-hosted" },
] as const;

export default function AdminOrganizationsPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "ACTIVE" | "SUSPENDED"
  >("all");

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
            ? "Organization paused"
            : "Organization resumed",
      });
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
      toast({ title: `Plan set to ${data.planLabel}` });
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
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Organizations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pause access, change plans, and see who owns each workspace.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or slug"
          className="sm:max-w-xs"
          aria-label="Search organizations"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) =>
            setStatusFilter(v as "all" | "ACTIVE" | "SUSPENDED")
          }
        >
          <SelectTrigger className="w-[160px]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="SUSPENDED">Paused</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground sm:ml-auto">
          {list.data?.total ?? 0} total
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border">
        {list.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (list.data?.items ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No organizations match this search.
          </p>
        ) : (
          <ul className="divide-y">
            {(list.data?.items ?? []).map((org) => {
              const paused = org.status === "SUSPENDED";
              const busy =
                (setStatus.isPending &&
                  setStatus.variables?.id === org.id) ||
                (setPlan.isPending && setPlan.variables?.id === org.id);

              return (
                <li
                  key={org.id}
                  className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-medium">{org.name}</h2>
                      <Badge
                        variant={paused ? "secondary" : "outline"}
                        className={cn(
                          "text-[10px] font-normal",
                          paused &&
                            "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {org.statusLabel}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {org.planLabel}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {org.slug}
                      {" · "}
                      {org.memberCount}{" "}
                      {org.memberCount === 1 ? "member" : "members"}
                      {org.owner
                        ? ` · ${org.owner.name || org.owner.email}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={org.plan}
                      disabled={busy}
                      onValueChange={(plan) =>
                        setPlan.mutate({
                          id: org.id,
                          plan: plan as (typeof PLAN_OPTIONS)[number]["value"],
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLAN_OPTIONS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      size="sm"
                      variant={paused ? "default" : "outline"}
                      disabled={busy}
                      onClick={() =>
                        setStatus.mutate({
                          id: org.id,
                          status: paused ? "ACTIVE" : "SUSPENDED",
                        })
                      }
                    >
                      {paused ? "Resume" : "Pause"}
                    </Button>
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
