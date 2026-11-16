"use client";

import {
  EmptyState,
  FilterBar,
  PageHeader,
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
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Building2,
  ChevronRight,
  ExternalLink,
  Shield,
  ShieldAlert,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

export default function AdminPeoplePage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [roleFilter, setRoleFilter] = useState<"all" | "ADMIN" | "USER" | "ENTERPRISE">(
    "all",
  );

  const list = trpc.platform.listPeople.useQuery(
    {
      query: deferredQuery || undefined,
      limit: 50,
    },
    { staleTime: 10_000 },
  );

  const items = useMemo(() => {
    const rows = list.data?.items ?? [];
    if (roleFilter === "all") return rows;
    return rows.filter((p) => p.role === roleFilter);
  }, [list.data?.items, roleFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        kicker="Identity & Access"
        title="People & Operator Directory"
        description="Manage user profiles, assign superadmin privileges, inspect organization affiliations, and audit accounts."
      />

      {/* Filter Bar */}
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search by person name or email…"
        resultCount={items.length}
        onClear={() => {
          setQuery("");
          setRoleFilter("all");
        }}
      >
        <Select
          value={roleFilter}
          onValueChange={(v) =>
            setRoleFilter(v as "all" | "ADMIN" | "USER" | "ENTERPRISE")
          }
        >
          <SelectTrigger className="h-9 w-[150px] text-xs font-medium border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="ADMIN">Platform Admin</SelectItem>
            <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
            <SelectItem value="USER">Standard User</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {/* People Table / List */}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/50 dark:backdrop-blur-md">
        {list.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No matching profiles found"
            description={
              query || roleFilter !== "all"
                ? "No people matched your filter query. Try broadening your criteria."
                : "No registered accounts exist on this platform instance yet."
            }
            action={
              query || roleFilter !== "all" ? (
                <TacticalButton
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setRoleFilter("all");
                  }}
                >
                  Clear Filters
                </TacticalButton>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border/50 dark:divide-white/[0.05]">
            {items.map((person) => {
              const initials = (person.name || person.email || "?")
                .slice(0, 2)
                .toUpperCase();

              return (
                <li
                  key={person.id}
                  className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {/* User Avatar Initial */}
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                        person.isPlatformAdmin
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/60 bg-muted/50 text-foreground/80 dark:border-white/[0.08] dark:bg-zinc-900",
                      )}
                    >
                      {initials}
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/people/${person.id}`}
                          className="truncate font-heading text-sm font-semibold text-foreground hover:text-primary transition-colors"
                        >
                          {person.name || person.email}
                        </Link>

                        {person.isPlatformAdmin ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            <Shield className="h-3 w-3" />
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:border-white/[0.06]">
                            {person.role === "ENTERPRISE" ? "Enterprise" : "Standard"}
                          </span>
                        )}

                        {person.paused ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            <ShieldAlert className="h-3 w-3" />
                            Paused
                          </span>
                        ) : null}
                      </div>

                      {person.name ? (
                        <p className="truncate text-xs text-muted-foreground font-mono">
                          {person.email}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* Badges & Actions */}
                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground/70" />
                      <span>
                        {person.organizationCount}{" "}
                        {person.organizationCount === 1 ? "org" : "orgs"}
                      </span>
                    </span>

                    <TacticalButton asChild size="sm" variant="outline" className="h-8 text-xs gap-1">
                      <Link href={`/admin/people/${person.id}`}>
                        <span>Manage</span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    </TacticalButton>
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
