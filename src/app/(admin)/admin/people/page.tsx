"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { useDeferredValue, useState } from "react";

export default function AdminPeoplePage() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const list = trpc.platform.listPeople.useQuery(
    {
      query: deferredQuery || undefined,
      limit: 50,
    },
    { staleTime: 10_000 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          People
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone with a Skillmark account on this instance.
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
        <p className="text-xs text-muted-foreground sm:ml-auto">
          {list.data?.total ?? 0} total
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border">
        {list.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (list.data?.items ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No people match this search.
          </p>
        ) : (
          <ul className="divide-y">
            {(list.data?.items ?? []).map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {person.name || person.email}
                  </p>
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
                  ) : null}
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {person.organizationCount}{" "}
                    {person.organizationCount === 1
                      ? "organization"
                      : "organizations"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
