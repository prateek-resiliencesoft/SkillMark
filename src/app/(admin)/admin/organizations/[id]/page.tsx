"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { adminActionLabel } from "@/lib/admin-actions";
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
import { formatLimit } from "@/lib/billing/catalog";
import { FEATURE_FLAG_META } from "@/lib/platform-settings";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const PLAN_OPTIONS = [
  { value: "FREE", label: "Free" },
  { value: "PRO", label: "Pro" },
  { value: "ENTERPRISE", label: "Enterprise" },
  { value: "SELF_HOSTED", label: "Self-hosted" },
] as const;

const MEMBER_ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
] as const;

function limitInputValue(n: number | null): string {
  return n === null ? "" : String(n);
}

function parseLimit(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export default function AdminOrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const org = trpc.platform.getOrganization.useQuery(
    { id },
    { staleTime: 5_000 },
  );

  const [seats, setSeats] = useState("");
  const [interviews, setInterviews] = useState("");
  const [projects, setProjects] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [pauseOpen, setPauseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState("");
  const [restoreSlug, setRestoreSlug] = useState("");

  useEffect(() => {
    if (!org.data) return;
    setSeats(limitInputValue(org.data.limits.seats));
    setInterviews(limitInputValue(org.data.limits.interviews));
    setProjects(limitInputValue(org.data.limits.projects));
    setOrgName(org.data.name);
    setOrgSlug(org.data.slug);
    const ff = org.data.featureFlags as Record<string, unknown>;
    setFlags({
      aiSettings: ff.aiSettings !== false,
      integrations: ff.integrations !== false,
      voiceInterviews: ff.voiceInterviews !== false,
      publicForms: ff.publicForms !== false,
      usageDashboard: ff.usageDashboard !== false,
    });
  }, [org.data]);

  const invalidate = () => {
    utils.platform.getOrganization.invalidate({ id });
    utils.platform.listOrganizations.invalidate();
    utils.platform.overview.invalidate();
    utils.platform.recentAudit.invalidate();
  };

  const setStatus = trpc.platform.setOrganizationStatus.useMutation({
    onSuccess: (data) => {
      toast({
        title:
          data.status === "SUSPENDED"
            ? "Organization paused"
            : "Organization resumed",
      });
      setPauseOpen(false);
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not update status",
        description: err.message,
        variant: "destructive",
      }),
  });

  const setPlan = trpc.platform.setOrganizationPlan.useMutation({
    onSuccess: (data) => {
      toast({ title: `Plan set to ${data.planLabel}` });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not update plan",
        description: err.message,
        variant: "destructive",
      }),
  });

  const setLimits = trpc.platform.setOrganizationLimits.useMutation({
    onSuccess: () => {
      toast({ title: "Limits updated" });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not update limits",
        description: err.message,
        variant: "destructive",
      }),
  });

  const softDelete = trpc.platform.softDeleteOrganization.useMutation({
    onSuccess: () => {
      toast({ title: "Organization removed" });
      setDeleteOpen(false);
      invalidate();
      router.push("/admin/organizations");
    },
    onError: (err) =>
      toast({
        title: "Could not remove organization",
        description: err.message,
        variant: "destructive",
      }),
  });

  const restore = trpc.platform.restoreOrganization.useMutation({
    onSuccess: () => {
      toast({ title: "Organization restored" });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not restore",
        description: err.message,
        variant: "destructive",
      }),
  });

  const setMemberRole = trpc.platform.setMemberRole.useMutation({
    onSuccess: (data) => {
      toast({ title: `Role set to ${data.roleLabel}` });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not change role",
        description: err.message,
        variant: "destructive",
      }),
  });

  const removeMember = trpc.platform.removeMember.useMutation({
    onSuccess: () => {
      toast({ title: "Member removed" });
      setRemoveMemberId(null);
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not remove member",
        description: err.message,
        variant: "destructive",
      }),
  });

  const updateOrg = trpc.platform.updateOrganization.useMutation({
    onSuccess: () => {
      toast({ title: "Organization details saved" });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save details",
        description: err.message,
        variant: "destructive",
      }),
  });

  const setFlagsMut = trpc.platform.setFeatureFlags.useMutation({
    onSuccess: () => {
      toast({ title: "Features updated" });
      invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not update features",
        description: err.message,
        variant: "destructive",
      }),
  });

  if (org.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (org.error || !org.data) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/organizations">← Organizations</Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          {org.error?.message ?? "Organization not found."}
        </p>
      </div>
    );
  }

  const data = org.data;
  const paused = data.status === "SUSPENDED";
  const removed = data.status === "DELETED";
  const removeTarget = data.members.find((m) => m.userId === removeMemberId);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin/organizations">← Organizations</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight">
                {data.name}
              </h1>
              <Badge
                variant={paused || removed ? "secondary" : "outline"}
                className={cn(
                  "text-[10px] font-normal",
                  paused &&
                    "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  removed && "bg-destructive/10 text-destructive",
                )}
              >
                {data.statusLabel}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-normal">
                {data.planLabel}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {data.slug}
              {data.owner
                ? ` · Owner ${data.owner.name || data.owner.email}`
                : ""}
            </p>
          </div>

          {!removed ? (
            <div className="flex flex-wrap gap-2">
              <Select
                value={data.plan}
                onValueChange={(plan) =>
                  setPlan.mutate({
                    id,
                    plan: plan as (typeof PLAN_OPTIONS)[number]["value"],
                  })
                }
              >
                <SelectTrigger className="h-9 w-[150px] text-xs">
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
                onClick={() => setPauseOpen(true)}
              >
                {paused ? "Resume" : "Pause"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Members", value: data.memberCount },
          { label: "Projects", value: data.projectCount },
          { label: "Interviews", value: data.interviewCount },
          { label: "Pending invites", value: data.pendingInviteCount },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border bg-card/60 p-4 backdrop-blur-sm"
          >
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-heading text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {!removed ? (
        <section className="space-y-4 rounded-xl border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">User-panel config</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Edit the same AI and messaging settings organizations manage in
                the product.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/admin/organizations/${id}/ai`}>AI settings</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/admin/organizations/${id}/integrations`}>
                  Integrations
                </Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {!removed ? (
        <section className="space-y-4 rounded-xl border p-5">
          <div>
            <h2 className="text-sm font-medium">Details</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Name and slug shown across the product.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs">
              <span className="text-muted-foreground">Name</span>
              <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="text-muted-foreground">Slug</span>
              <Input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} />
            </label>
          </div>
          <Button
            size="sm"
            disabled={updateOrg.isPending}
            onClick={() =>
              updateOrg.mutate({
                id,
                name: orgName.trim(),
                slug: orgSlug.trim(),
              })
            }
          >
            Save details
          </Button>
        </section>
      ) : null}

      {!removed ? (
        <section className="space-y-4 rounded-xl border p-5">
          <div>
            <h2 className="text-sm font-medium">Features</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Toggle product areas for this organization.
            </p>
          </div>
          <ul className="space-y-3">
            {FEATURE_FLAG_META.map((item) => (
              <li key={item.key} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border"
                  checked={Boolean(flags[item.key])}
                  onChange={(e) =>
                    setFlags((prev) => ({
                      ...prev,
                      [item.key]: e.target.checked,
                    }))
                  }
                />
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </div>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            disabled={setFlagsMut.isPending}
            onClick={() =>
              setFlagsMut.mutate({
                id,
                featureFlags: {
                  aiSettings: Boolean(flags.aiSettings),
                  integrations: Boolean(flags.integrations),
                  voiceInterviews: Boolean(flags.voiceInterviews),
                  publicForms: Boolean(flags.publicForms),
                  usageDashboard: Boolean(flags.usageDashboard),
                },
              })
            }
          >
            Save features
          </Button>
        </section>
      ) : null}

      {!removed ? (
        <section className="space-y-4 rounded-xl border p-5">
          <div>
            <h2 className="text-sm font-medium">Usage limits</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Empty field = unlimited. Overrides the plan defaults for this
              organization.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["Seats", seats, setSeats, data.limits.seats],
                ["Interviews", interviews, setInterviews, data.limits.interviews],
                ["Projects", projects, setProjects, data.limits.projects],
              ] as const
            ).map(([label, value, setter, current]) => (
              <label key={label} className="space-y-1.5 text-xs">
                <span className="text-muted-foreground">
                  {label}{" "}
                  <span className="text-[10px]">
                    (now {formatLimit(current)})
                  </span>
                </span>
                <Input
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  placeholder="Unlimited"
                />
              </label>
            ))}
          </div>
          <Button
            size="sm"
            disabled={setLimits.isPending}
            onClick={() =>
              setLimits.mutate({
                id,
                seats: parseLimit(seats),
                interviews: parseLimit(interviews),
                projects: parseLimit(projects),
              })
            }
          >
            Save limits
          </Button>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Members</h2>
        <div className="overflow-hidden rounded-xl border">
          {data.members.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No members.
            </p>
          ) : (
            <ul className="divide-y">
              {data.members.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.name || m.email}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.email}
                      {m.platformRole === "ADMIN" ? " · Platform admin" : ""}
                    </p>
                  </div>
                  {!removed ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {m.role === "OWNER" ? (
                        <Badge variant="outline" className="text-[10px]">
                          Owner
                        </Badge>
                      ) : (
                        <>
                          <Select
                            value={m.role}
                            disabled={setMemberRole.isPending}
                            onValueChange={(role) =>
                              setMemberRole.mutate({
                                organizationId: id,
                                userId: m.userId,
                                role: role as (typeof MEMBER_ROLES)[number]["value"],
                              })
                            }
                          >
                            <SelectTrigger className="h-8 w-[120px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MEMBER_ROLES.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => setRemoveMemberId(m.userId)}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/people/${m.userId}`}>Person</Link>
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-sm font-medium">Billing</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Billing email</dt>
            <dd className="mt-1 truncate">
              {data.billing.email || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Stripe customer</dt>
            <dd className="mt-1 truncate font-mono text-xs">
              {data.billing.stripeCustomerId || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Subscription</dt>
            <dd className="mt-1 truncate font-mono text-xs">
              {data.billing.stripeSubscriptionId || "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Recent admin actions</h2>
        <div className="overflow-hidden rounded-xl border">
          {data.recentAudit.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No admin actions on this organization yet.
            </p>
          ) : (
            <ul className="divide-y">
              {data.recentAudit.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {adminActionLabel(row.action)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.actorName}
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

      <section className="space-y-4 rounded-xl border border-destructive/30 p-5">
        <div>
          <h2 className="text-sm font-medium text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Soft-remove keeps data for audit. Members lose access immediately.
            Prefer pause when you might restore later.
          </p>
        </div>
        {removed ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs">
              <span className="text-muted-foreground">Restore name</span>
              <Input
                value={restoreName}
                onChange={(e) => setRestoreName(e.target.value)}
                placeholder="Organization name"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="text-muted-foreground">Restore slug</span>
              <Input
                value={restoreSlug}
                onChange={(e) => setRestoreSlug(e.target.value)}
                placeholder="org-slug"
              />
            </label>
            <Button
              size="sm"
              className="sm:col-span-2 sm:w-fit"
              disabled={
                restore.isPending || !restoreName.trim() || !restoreSlug.trim()
              }
              onClick={() =>
                restore.mutate({
                  id,
                  name: restoreName.trim(),
                  slug: restoreSlug.trim(),
                })
              }
            >
              Restore organization
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            Remove organization
          </Button>
        )}
      </section>

      <ConfirmAction
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        title={paused ? `Resume “${data.name}”?` : `Pause “${data.name}”?`}
        description={
          paused
            ? "Members can use the product again for this organization."
            : "Members keep their data but cannot create or change work until you resume."
        }
        confirmLabel={paused ? "Resume organization" : "Pause organization"}
        pending={setStatus.isPending}
        onConfirm={() =>
          setStatus.mutate({
            id,
            status: paused ? "ACTIVE" : "SUSPENDED",
          })
        }
      />

      <ConfirmAction
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Remove “${data.name}”?`}
        description="Pending invites are revoked. Data is kept for audit but the organization is hidden from normal use. Type the organization name to continue."
        confirmLabel="Remove organization"
        confirmText={data.name}
        destructive
        pending={softDelete.isPending}
        onConfirm={() =>
          softDelete.mutate({ id, confirmName: data.name })
        }
      />

      <ConfirmAction
        open={Boolean(removeMemberId)}
        onOpenChange={(open) => {
          if (!open) setRemoveMemberId(null);
        }}
        title={`Remove ${removeTarget?.name || removeTarget?.email || "member"}?`}
        description="They lose access to this organization immediately. Their account remains."
        confirmLabel="Remove member"
        destructive
        pending={removeMember.isPending}
        onConfirm={() => {
          if (!removeMemberId) return;
          removeMember.mutate({
            organizationId: id,
            userId: removeMemberId,
          });
        }}
      />
    </div>
  );
}
