"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { OrgActivity } from "@/components/admin/org-activity";
import {
  EmptyState,
  PageHeader,
  Panel,
  StatCard,
  StatusPill,
  TacticalButton,
  formatWhen,
} from "@/components/admin/admin-ui";
import { adminActionLabel } from "@/lib/admin-actions";
import { Badge } from "@/components/ui/badge";
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
import {
  AlertTriangle,
  Bot,
  Building2,
  CreditCard,
  ExternalLink,
  FolderGit2,
  Mail,
  Pause,
  Play,
  Radio,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

  const activity = trpc.platformOps.memberActivity.useQuery(
    { orgId: id },
    { staleTime: 30_000 },
  );
  const org = trpc.platform.getOrganization.useQuery(
    { id },
    { staleTime: 5_000 },
  );
  const settings = trpc.platform.getSettings.useQuery(undefined, {
    staleTime: 30_000,
  });
  const planOptions = (settings.data?.planCatalog ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }));

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
            ? "Organization suspended"
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
      toast({ title: `Plan updated to ${data.planLabel}` });
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
      toast({ title: "Custom limits applied" });
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
      toast({ title: "Organization and all its data deleted" });
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
      toast({ title: `Role updated to ${data.roleLabel}` });
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
      toast({ title: "Member removed from organization" });
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
      toast({ title: "Organization identity updated" });
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
      toast({ title: "Feature gates updated" });
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
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (org.error || !org.data) {
    return (
      <div className="space-y-4">
        <TacticalButton asChild variant="ghost" size="sm">
          <Link href="/admin/organizations">← Back to Organizations</Link>
        </TacticalButton>
        <EmptyState
          icon={Building2}
          title="Organization not found"
          description={org.error?.message ?? "The requested organization does not exist."}
        />
      </div>
    );
  }

  const data = org.data;
  const paused = data.status === "SUSPENDED";
  const removed = data.status === "DELETED";
  const removeTarget = data.members.find((m) => m.userId === removeMemberId);

  return (
    <div className="space-y-8">
      {/* Header & Breadcrumbs */}
      <PageHeader
        breadcrumbs={[
          { label: "Organizations", href: "/admin/organizations" },
          { label: data.name },
        ]}
        title={data.name}
        description={
          data.owner
            ? `Slug: ${data.slug} · Primary Owner: ${data.owner.name || data.owner.email}`
            : `Slug: ${data.slug}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              status={data.status}
              label={data.statusLabel}
              pulse={data.status === "ACTIVE"}
            />

            {!removed ? (
              <>
                <Select
                  value={data.plan}
                  disabled={planOptions.length === 0}
                  onValueChange={(plan) =>
                    setPlan.mutate({
                      id,
                      plan,
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-[140px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900">
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
                  onClick={() => setPauseOpen(true)}
                  className="h-8 text-xs gap-1.5"
                >
                  {paused ? (
                    <>
                      <Play className="h-3 w-3 fill-current" />
                      <span>Resume Org</span>
                    </>
                  ) : (
                    <>
                      <Pause className="h-3 w-3" />
                      <span>Pause Org</span>
                    </>
                  )}
                </TacticalButton>
              </>
            ) : null}
          </div>
        }
      />

      {/* KPI Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Members"
          value={data.memberCount}
          subtitle="Enrolled recruiters & reviewers"
          icon={Users}
          accentColor="#5941F2"
        />
        <StatCard
          title="Projects"
          value={data.projectCount}
          subtitle="Active recruitment funnels"
          icon={FolderGit2}
          accentColor="#296CF2"
        />
        <StatCard
          title="Interviews"
          value={data.interviewCount}
          subtitle="Templates and question banks"
          icon={Radio}
          accentColor="#8B5CF6"
        />
        <StatCard
          title="Pending Invites"
          value={data.pendingInviteCount}
          subtitle="Awaiting candidate verification"
          icon={Mail}
          accentColor="#06B6D4"
        />
      </div>

      {/* Quick Links Sub-bar */}
      {!removed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/40">
          <div className="text-xs">
            <span className="font-semibold text-foreground">Operational Overrides:</span>{" "}
            <span className="text-muted-foreground">
              Directly inspect and customize AI models or webhook configurations for this tenant.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <TacticalButton asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5">
              <Link href={`/admin/organizations/${id}/ai`}>
                <Bot className="h-3.5 w-3.5 text-primary" />
                <span>AI Models & Prompts</span>
              </Link>
            </TacticalButton>
            <TacticalButton asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5">
              <Link href={`/admin/organizations/${id}/integrations`}>
                <Webhook className="h-3.5 w-3.5 text-primary" />
                <span>Integrations & Webhooks</span>
              </Link>
            </TacticalButton>
          </div>
        </div>
      ) : null}

      {/* Core Details Panel */}
      {!removed ? (
        <Panel
          kicker="Tenant Identity"
          title="General Details"
          description="Public organization label and tenant identifier slug."
        >
          <div className="space-y-4 max-w-xl">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Organization Name</span>
                <Input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="h-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-foreground">Subdomain / URL Slug</span>
                <Input
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                />
              </label>
            </div>
            <TacticalButton
              size="sm"
              loading={updateOrg.isPending}
              onClick={() =>
                updateOrg.mutate({
                  id,
                  name: orgName.trim(),
                  slug: orgSlug.trim(),
                })
              }
              className="gap-1.5 text-xs h-8"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Update Organization</span>
            </TacticalButton>
          </div>
        </Panel>
      ) : null}

      {/* Usage Limits Panel */}
      {!removed ? (
        <Panel
          kicker="Quota Allocation"
          title="Custom Quota Overrides"
          description="Empty field = unlimited. These values supersede standard tier quotas for this tenant."
        >
          <div className="space-y-4 max-w-2xl">
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["Member Seats", seats, setSeats, data.limits.seats],
                  ["Interviews / Mo", interviews, setInterviews, data.limits.interviews],
                  ["Projects", projects, setProjects, data.limits.projects],
                ] as const
              ).map(([label, value, setter, current]) => (
                <label key={label} className="space-y-1 text-xs">
                  <span className="font-medium text-foreground flex items-center justify-between">
                    <span>{label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      (active: {formatLimit(current)})
                    </span>
                  </span>
                  <Input
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder="Unlimited"
                    className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                  />
                </label>
              ))}
            </div>

            <TacticalButton
              size="sm"
              loading={setLimits.isPending}
              onClick={() =>
                setLimits.mutate({
                  id,
                  seats: parseLimit(seats),
                  interviews: parseLimit(interviews),
                  projects: parseLimit(projects),
                })
              }
              className="gap-1.5 text-xs h-8"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save Quota Overrides</span>
            </TacticalButton>
          </div>
        </Panel>
      ) : null}

      {/* Feature Gates Panel */}
      {!removed ? (
        <Panel
          kicker="Entitlements"
          title="Feature Gate Access"
          description="Grant or restrict specific product modules for this organization."
        >
          <div className="space-y-4">
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {FEATURE_FLAG_META.map((item) => (
                <li
                  key={item.key}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer select-none",
                    flags[item.key]
                      ? "border-primary/40 bg-primary/[0.04] dark:bg-primary/[0.08]"
                      : "border-border/60 bg-muted/20 dark:border-white/[0.06]",
                  )}
                  onClick={() =>
                    setFlags((prev) => ({
                      ...prev,
                      [item.key]: !prev[item.key],
                    }))
                  }
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 rounded border-border/80 text-primary accent-primary"
                    checked={Boolean(flags[item.key])}
                    onChange={(e) =>
                      setFlags((prev) => ({
                        ...prev,
                        [item.key]: e.target.checked,
                      }))
                    }
                  />
                  <div>
                    <p className="text-xs font-semibold text-foreground">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-normal">{item.hint}</p>
                  </div>
                </li>
              ))}
            </ul>

            <TacticalButton
              size="sm"
              loading={setFlagsMut.isPending}
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
              className="gap-1.5 text-xs h-8"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Update Feature Gates</span>
            </TacticalButton>
          </div>
        </Panel>
      ) : null}

      {/* Activity Graph Component */}
      <OrgActivity orgId={id} />

      {/* Organization Members Panel */}
      <Panel
        kicker="Team"
        title="Interviewers & Organization Members"
        description={`${data.members.length} registered team members.`}
      >
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card dark:border-white/[0.08] dark:bg-zinc-950/60">
          {data.members.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No members enrolled"
              description="This organization does not currently have any active members."
            />
          ) : (
            <ul className="divide-y divide-border/50 dark:divide-white/[0.05]">
              {data.members.map((m) => {
                const initials = (m.name || m.email).slice(0, 2).toUpperCase();

                return (
                  <li
                    key={m.id}
                    className="flex flex-col gap-3 p-3.5 transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted text-xs font-bold text-foreground">
                        {initials}
                      </div>

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {m.name || m.email}
                          </p>
                          {m.platformRole === "ADMIN" ? (
                            <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.2 text-[9px] font-semibold text-primary">
                              Platform Admin
                            </span>
                          ) : null}
                        </div>

                        <p className="truncate text-[11px] text-muted-foreground font-mono">
                          {m.email}
                        </p>

                        <p className="truncate text-[10px] text-muted-foreground">
                          {activity.data?.[m.userId]
                            ? `${activity.data[m.userId].interviews} interviews · ${activity.data[m.userId].sessions} sessions (${activity.data[m.userId].completed} completed) · last active ${formatWhen(activity.data[m.userId].lastSessionAt)}`
                            : activity.isLoading
                              ? "Sampling member activity…"
                              : "No interview activity recorded"}
                        </p>
                      </div>
                    </div>

                    {!removed ? (
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                        {m.role === "OWNER" ? (
                          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 uppercase">
                            Primary Owner
                          </span>
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
                              <SelectTrigger className="h-7 w-[105px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="text-xs">
                                {MEMBER_ROLES.map((r) => (
                                  <SelectItem key={r.value} value={r.value}>
                                    {r.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <TacticalButton
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-rose-500 hover:text-rose-600 text-xs gap-1"
                              onClick={() => setRemoveMemberId(m.userId)}
                            >
                              <UserMinus className="h-3 w-3" />
                              <span>Remove</span>
                            </TacticalButton>
                          </>
                        )}

                        <TacticalButton asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                          <Link href={`/admin/people/${m.userId}`}>View Profile</Link>
                        </TacticalButton>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>

      {/* Commercial & Billing Metadata */}
      <Panel
        kicker="Commercials"
        title="Billing & Customer Records"
        description="Associated Stripe customer and subscription identity."
      >
        <dl className="grid gap-4 text-xs sm:grid-cols-3">
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 dark:border-white/[0.04]">
            <dt className="text-muted-foreground font-medium">Billing Contact</dt>
            <dd className="mt-1 font-semibold text-foreground truncate">
              {data.billing.email || "No billing email attached"}
            </dd>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 dark:border-white/[0.04]">
            <dt className="text-muted-foreground font-medium">Stripe Customer ID</dt>
            <dd className="mt-1 font-mono text-foreground truncate">
              {data.billing.stripeCustomerId || "Unlinked"}
            </dd>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 dark:border-white/[0.04]">
            <dt className="text-muted-foreground font-medium">Active Subscription ID</dt>
            <dd className="mt-1 font-mono text-foreground truncate">
              {data.billing.stripeSubscriptionId || "None (Free/Self-hosted)"}
            </dd>
          </div>
        </dl>
      </Panel>

      {/* Danger Zone Panel */}
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.03] p-5 dark:border-rose-500/20 dark:bg-rose-950/10 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          <h2 className="font-heading text-sm font-bold text-rose-600 dark:text-rose-400">
            Danger Zone
          </h2>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Soft-removing an organization preserves candidate records for forensic audits while revoking all member access. Prefer pausing when the organization may resume operations later.
        </p>

        {removed ? (
          <div className="grid gap-3 sm:grid-cols-2 pt-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Reinstated Organization Name</span>
              <Input
                value={restoreName}
                onChange={(e) => setRestoreName(e.target.value)}
                placeholder="Organization name"
                className="h-8 text-xs border-border/70 dark:border-white/[0.08]"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Reinstated URL Slug</span>
              <Input
                value={restoreSlug}
                onChange={(e) => setRestoreSlug(e.target.value)}
                placeholder="org-slug"
                className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08]"
              />
            </label>
            <TacticalButton
              size="sm"
              className="sm:col-span-2 sm:w-fit text-xs h-8"
              disabled={restore.isPending || !restoreName.trim() || !restoreSlug.trim()}
              onClick={() =>
                restore.mutate({
                  id,
                  name: restoreName.trim(),
                  slug: restoreSlug.trim(),
                })
              }
            >
              Restore Organization Access
            </TacticalButton>
          </div>
        ) : (
          <div className="pt-2">
            <TacticalButton
              size="sm"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              className="text-xs h-8 gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Remove Organization</span>
            </TacticalButton>
          </div>
        )}
      </div>

      {/* Confirmation Modals */}
      <ConfirmAction
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        title={paused ? `Resume “${data.name}”?` : `Pause “${data.name}”?`}
        description={
          paused
            ? "Team members will immediately regain full access to run interviews and create projects."
            : "Team members retain data but cannot conduct or create new interviews until resumed."
        }
        confirmLabel={paused ? "Resume Organization" : "Pause Organization"}
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
        title={`Permanently remove “${data.name}”?`}
        description="This permanently deletes the organization and ALL of its data: projects, interviews, sessions, candidates, applications, members, and every recording, image and CV stored on the server. This cannot be undone. Type the organization name to proceed."
        confirmLabel="Delete organization and all data"
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
        description="This user will lose access to this organization immediately. Their platform account remains intact."
        confirmLabel="Remove Member"
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
