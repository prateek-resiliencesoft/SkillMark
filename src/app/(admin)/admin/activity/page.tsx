"use client";

import { adminActionLabel } from "@/lib/admin-actions";
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Activity
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who changed what — organizations, people, and memberships.
          </p>
        </div>
        <Select
          value={filter}
          onValueChange={(v) =>
            setFilter(v as "all" | "org" | "user" | "member")
          }
        >
          <SelectTrigger className="w-[160px]" aria-label="Filter activity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="org">Organizations</SelectItem>
            <SelectItem value="user">People</SelectItem>
            <SelectItem value="member">Members</SelectItem>
          </SelectContent>
        </Select>
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
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {adminActionLabel(row.action)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.actorName}
                      {bits ? ` · ${bits}` : ""}
                    </p>
                  </div>
                  {href ? (
                    <Link
                      href={href}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Open
                    </Link>
                  ) : null}
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {new Date(row.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
