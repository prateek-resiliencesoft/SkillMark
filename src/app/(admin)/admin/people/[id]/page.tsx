"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import {
  EmptyState,
  PageHeader,
  Panel,
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
  AlertTriangle,
  Building2,
  ExternalLink,
  KeyRound,
  Lock,
  Pause,
  Play,
  Shield,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

const PLATFORM_ROLES = [
  { value: "USER", label: "Standard User" },
  { value: "ADMIN", label: "Platform Admin (Superadmin)" },
  { value: "ENTERPRISE", label: "Enterprise Operator" },
] as const;

export default function AdminPersonDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const router = useRouter();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<
    (typeof PLATFORM_ROLES)[number]["value"] | null
  >(null);

  const person = trpc.platform.getPerson.useQuery(
    { id },
    { staleTime: 5_000 },
  );

  const setRole = trpc.platform.setPlatformRole.useMutation({
    onSuccess: (data) => {
      toast({ title: `Platform role updated to ${data.roleLabel}` });
      setPendingRole(null);
      utils.platform.getPerson.invalidate({ id });
      utils.platform.listPeople.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not change platform role",
        description: err.message,
        variant: "destructive",
      }),
  });

  const setStatus = trpc.platform.setPersonStatus.useMutation({
    onSuccess: (res) => {
      toast({ title: res.paused ? "Account suspended" : "Account reactivated" });
      setPauseOpen(false);
      utils.platform.getPerson.invalidate({ id });
      utils.platform.listPeople.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not update account status",
        description: err.message,
        variant: "destructive",
      }),
  });

  const resetPassword = trpc.platformOps.resetPassword.useMutation({
    onSuccess: (res) => {
      setResetOpen(false);
      setTempPassword(res.temporaryPassword);
      utils.platform.recentAudit.invalidate();
      toast({ title: "Temporary password generated" });
    },
    onError: (err) =>
      toast({
        title: "Could not reset password",
        description: err.message,
        variant: "destructive",
      }),
  });

  const deletePerson = trpc.platform.deletePerson.useMutation({
    onSuccess: () => {
      toast({ title: "Account permanently deleted" });
      setDeleteOpen(false);
      utils.platform.listPeople.invalidate();
      utils.platform.recentAudit.invalidate();
      router.push("/admin/people");
    },
    onError: (err) =>
      toast({
        title: "Could not delete account",
        description: err.message,
        variant: "destructive",
      }),
  });

  if (person.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    );
  }

  if (person.error || !person.data) {
    return (
      <div className="space-y-4">
        <TacticalButton asChild variant="ghost" size="sm">
          <Link href="/admin/people">← Back to People</Link>
        </TacticalButton>
        <EmptyState
          icon={Users}
          title="Account not found"
          description={person.error?.message ?? "The requested profile does not exist."}
        />
      </div>
    );
  }

  const data = person.data;
  const nextRoleLabel =
    PLATFORM_ROLES.find((r) => r.value === pendingRole)?.label ?? "this role";

  return (
    <div className="space-y-8">
      {/* Header & Breadcrumbs */}
      <PageHeader
        breadcrumbs={[
          { label: "People Directory", href: "/admin/people" },
          { label: data.name || data.email },
        ]}
        title={data.name || data.email}
        description={`Email: ${data.email} · Member since ${new Date(data.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data.isPlatformAdmin ? (
              <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Superadmin
              </span>
            ) : (
              <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {data.roleLabel}
              </span>
            )}

            {data.paused ? (
              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-500">
                Suspended
              </span>
            ) : null}

            <Select
              value={data.role}
              onValueChange={(role) =>
                setPendingRole(role as (typeof PLATFORM_ROLES)[number]["value"])
              }
            >
              <SelectTrigger className="h-8 w-[160px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs">
                {PLATFORM_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Security & Access Controls Panel */}
      <Panel
        kicker="Account Security"
        title="Security & Governance Controls"
        description="Suspend account authentication, rotate credentials, or permanently erase identity records."
      >
        <div className="space-y-4">
          <p className="max-w-2xl text-xs text-muted-foreground leading-relaxed">
            Suspending terminates active sessions and blocks new sign-ins. Resetting password generates a secure one-time temporary key. Deletion removes authentication profiles while keeping historical interview transcripts for forensic records.
          </p>

          {tempPassword ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-primary">
                <KeyRound className="h-4 w-4" />
                <span>One-Time Temporary Password</span>
              </div>
              <p className="select-all rounded-md border border-primary/20 bg-background/80 p-2.5 font-mono text-sm text-foreground">
                {tempPassword}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Copy and transmit this secret securely. The user will be required to change it immediately upon login.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40 dark:border-white/[0.04]">
            <TacticalButton
              size="sm"
              variant={data.paused ? "default" : "outline"}
              onClick={() => setPauseOpen(true)}
              className="h-8 text-xs gap-1.5"
            >
              {data.paused ? (
                <>
                  <Play className="h-3 w-3 fill-current" />
                  <span>Reactivate Account</span>
                </>
              ) : (
                <>
                  <Pause className="h-3 w-3" />
                  <span>Suspend Account</span>
                </>
              )}
            </TacticalButton>

            <TacticalButton
              size="sm"
              variant="outline"
              onClick={() => setResetOpen(true)}
              className="h-8 text-xs gap-1.5"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Issue Temporary Password</span>
            </TacticalButton>

            <TacticalButton
              size="sm"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              className="h-8 text-xs gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete User Account</span>
            </TacticalButton>
          </div>
        </div>
      </Panel>

      {/* Organization Memberships Panel */}
      <Panel
        kicker="Tenant Affiliations"
        title="Organization Memberships"
        description={`${data.memberships.length} organizations affiliated with this user profile.`}
      >
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card dark:border-white/[0.08] dark:bg-zinc-950/60">
          {data.memberships.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No organization memberships"
              description="This user is not currently affiliated with any tenant space."
            />
          ) : (
            <ul className="divide-y divide-border/50 dark:divide-white/[0.05]">
              {data.memberships.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-col gap-3 p-3.5 transition-colors hover:bg-muted/30 dark:hover:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted text-xs font-bold text-foreground">
                      {m.organizationName.slice(0, 2).toUpperCase()}
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate font-heading text-xs font-bold text-foreground">
                        {m.organizationName}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground font-mono">
                        {m.organizationSlug} · Role: {m.roleLabel}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <StatusPill
                      status={m.organizationStatus}
                      label={
                        m.organizationStatus === "SUSPENDED"
                          ? "Paused"
                          : m.organizationStatus === "DELETED"
                            ? "Removed"
                            : "Active"
                      }
                      pulse={m.organizationStatus === "ACTIVE"}
                    />

                    <TacticalButton asChild size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1">
                      <Link href={`/admin/organizations/${m.organizationId}`}>
                        <span>Inspect Tenant</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </TacticalButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {/* Confirmation Modals */}
      <ConfirmAction
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        title={data.paused ? "Reactivate this account?" : "Suspend this account?"}
        description={
          data.paused
            ? `${data.name || data.email} will immediately regain sign-in privileges.`
            : `${data.name || data.email} will be forcibly signed out and rejected on login.`
        }
        confirmLabel={data.paused ? "Reactivate Account" : "Suspend Account"}
        pending={setStatus.isPending}
        onConfirm={() => setStatus.mutate({ userId: id, paused: !data.paused })}
      />

      <ConfirmAction
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Generate temporary password?"
        description={`Current password will be immediately invalidated. You will receive a one-time temporary credential for ${data.name || data.email}.`}
        confirmLabel="Generate Password"
        pending={resetPassword.isPending}
        onConfirm={() => resetPassword.mutate({ userId: id })}
      />

      <ConfirmAction
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Permanently delete user profile?"
        description={`${data.email} will lose all authentication records, active sessions, and profile data. Organizations solely owned by them will be taken offline. This action cannot be undone.`}
        confirmLabel="Delete User Account"
        confirmText={data.email}
        confirmPlaceholder="Type the account email to confirm"
        destructive
        pending={deletePerson.isPending}
        onConfirm={() =>
          deletePerson.mutate({ userId: id, confirmEmail: data.email })
        }
      />

      <ConfirmAction
        open={Boolean(pendingRole) && pendingRole !== data.role}
        onOpenChange={(open) => {
          if (!open) setPendingRole(null);
        }}
        title={`Change platform privilege to ${nextRoleLabel}?`}
        description={
          pendingRole === "ADMIN"
            ? `${data.name || data.email} will receive full Superadmin authority over all organizations, server telemetry, and billing configurations.`
            : data.role === "ADMIN"
              ? `${data.name || data.email} will lose Superadmin control center access immediately.`
              : `Platform role will transition to ${nextRoleLabel}.`
        }
        confirmLabel="Update Platform Role"
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
