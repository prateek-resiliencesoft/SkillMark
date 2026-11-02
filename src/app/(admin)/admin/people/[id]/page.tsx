"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

const PLATFORM_ROLES = [
  { value: "USER", label: "Standard" },
  { value: "ADMIN", label: "Platform admin" },
  { value: "ENTERPRISE", label: "Enterprise" },
] as const;

export default function AdminPersonDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [pendingRole, setPendingRole] = useState<
    (typeof PLATFORM_ROLES)[number]["value"] | null
  >(null);

  const person = trpc.platform.getPerson.useQuery(
    { id },
    { staleTime: 5_000 },
  );

  const setRole = trpc.platform.setPlatformRole.useMutation({
    onSuccess: (data) => {
      toast({ title: `Access set to ${data.roleLabel}` });
      setPendingRole(null);
      utils.platform.getPerson.invalidate({ id });
      utils.platform.listPeople.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not change access",
        description: err.message,
        variant: "destructive",
      }),
  });

  if (person.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (person.error || !person.data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/people">← People</Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          {person.error?.message ?? "Person not found."}
        </p>
      </div>
    );
  }

  const data = person.data;
  const nextRoleLabel =
    PLATFORM_ROLES.find((r) => r.value === pendingRole)?.label ?? "this role";

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin/people">← People</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight">
                {data.name || data.email}
              </h1>
              <Badge
                variant={data.isPlatformAdmin ? "default" : "outline"}
                className="text-[10px] font-normal"
              >
                {data.roleLabel}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {data.email}
              {" · Joined "}
              {new Date(data.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>

          <Select
            value={data.role}
            onValueChange={(role) =>
              setPendingRole(role as (typeof PLATFORM_ROLES)[number]["value"])
            }
          >
            <SelectTrigger className="h-9 w-[170px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORM_ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Organizations</h2>
        <div className="overflow-hidden rounded-xl border">
          {data.memberships.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Not a member of any organization.
            </p>
          ) : (
            <ul className="divide-y">
              {data.memberships.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.organizationName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.organizationSlug} · {m.roleLabel}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-normal",
                      m.organizationStatus === "SUSPENDED" &&
                        "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                      m.organizationStatus === "DELETED" &&
                        "bg-destructive/10 text-destructive",
                    )}
                  >
                    {m.organizationStatus === "SUSPENDED"
                      ? "Paused"
                      : m.organizationStatus === "DELETED"
                        ? "Removed"
                        : "Active"}
                  </Badge>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/admin/organizations/${m.organizationId}`}>
                      Open
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ConfirmAction
        open={Boolean(pendingRole) && pendingRole !== data.role}
        onOpenChange={(open) => {
          if (!open) setPendingRole(null);
        }}
        title={`Change access to ${nextRoleLabel}?`}
        description={
          pendingRole === "ADMIN"
            ? `${data.name || data.email} will be able to open the control center and manage every organization.`
            : data.role === "ADMIN"
              ? `${data.name || data.email} will lose control-center access.`
              : `Platform role becomes ${nextRoleLabel}.`
        }
        confirmLabel="Change access"
        destructive={data.role === "ADMIN" && pendingRole !== "ADMIN"}
        pending={setRole.isPending}
        onConfirm={() => {
          if (!pendingRole) return;
          setRole.mutate({ userId: id, role: pendingRole });
        }}
      />
    </div>
  );
}
