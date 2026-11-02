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
import { trpc } from "@/lib/trpc/client";
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
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          People
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Promote platform admins, inspect memberships, and open a person&apos;s
          full control page.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          className="sm:max-w-xs"
          aria-label="Search people"
        />
        <Select
          value={roleFilter}
          onValueChange={(v) =>
            setRoleFilter(v as "all" | "ADMIN" | "USER" | "ENTERPRISE")
          }
        >
          <SelectTrigger className="w-[160px]" aria-label="Filter by role">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="ADMIN">Platform admin</SelectItem>
            <SelectItem value="USER">Standard</SelectItem>
            <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground sm:ml-auto">
          {items.length}
          {roleFilter !== "all" ? ` of ${list.data?.total ?? 0}` : ""} shown
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border">
        {list.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No people match this search.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/people/${person.id}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {person.name || person.email}
                  </Link>
                  {person.name ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {person.email}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {person.isPlatformAdmin ? (
                    <Badge className="text-[10px] font-normal">
                      Platform admin
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {person.role === "ENTERPRISE" ? "Enterprise" : "Standard"}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {person.organizationCount}{" "}
                    {person.organizationCount === 1
                      ? "organization"
                      : "organizations"}
                  </Badge>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/admin/people/${person.id}`}>Open</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
