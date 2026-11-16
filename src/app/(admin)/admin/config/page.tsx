"use client";

import {
  DEFAULT_PLAN_FEATURES,
  PROTECTED_PLAN_IDS,
  planIdOk,
  type PlanCatalogEntry,
  type PlanFeatureFlags,
} from "@/lib/billing/catalog";
import { FEATURE_FLAG_META } from "@/lib/platform-settings";
import {
  PageHeader,
  Panel,
  TacticalButton,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Check,
  CreditCard,
  Layers,
  Lock,
  Plus,
  Save,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

function limitField(value: number | null): string {
  return value === null ? "" : String(value);
}

function parseLimit(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

type PlanDraft = {
  id: string;
  name: string;
  blurb: string;
  seats: string;
  interviews: string;
  projects: string;
  purchaseable: boolean;
  stripePriceId: string;
  stripePriceEnv: string;
  features: PlanFeatureFlags;
};

function toDraft(p: PlanCatalogEntry): PlanDraft {
  return {
    id: p.id,
    name: p.name,
    blurb: p.blurb,
    seats: limitField(p.limits.seats),
    interviews: limitField(p.limits.interviews),
    projects: limitField(p.limits.projects),
    purchaseable: p.purchaseable,
    stripePriceId: p.stripePriceId ?? "",
    stripePriceEnv: p.stripePriceEnv ?? "",
    features: { ...p.features },
  };
}

function fromDraft(d: PlanDraft): PlanCatalogEntry {
  return {
    id: d.id.trim().toUpperCase(),
    name: d.name.trim(),
    blurb: d.blurb.trim(),
    limits: {
      seats: parseLimit(d.seats),
      interviews: parseLimit(d.interviews),
      projects: parseLimit(d.projects),
    },
    purchaseable: d.purchaseable,
    stripePriceId: d.stripePriceId.trim() || null,
    stripePriceEnv: d.stripePriceEnv.trim() || null,
    features: { ...d.features },
  };
}

export default function AdminConfigPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const settings = trpc.platform.getSettings.useQuery(undefined, {
    staleTime: 5_000,
  });

  const [maxOrgs, setMaxOrgs] = useState("10");
  const [allowSelfDelete, setAllowSelfDelete] = useState(true);
  const [allowBilling, setAllowBilling] = useState(true);
  const [plans, setPlans] = useState<PlanDraft[]>([]);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [newPlanId, setNewPlanId] = useState("");

  useEffect(() => {
    if (!settings.data) return;
    setMaxOrgs(String(settings.data.instance.maxOrgsPerAccount));
    setAllowSelfDelete(settings.data.instance.allowOrgSelfDelete);
    setAllowBilling(settings.data.instance.allowOrgSelfServeBilling);
    setPlans(settings.data.planCatalog.map(toDraft));
    setFlags({ ...settings.data.defaultFeatureFlags });
  }, [settings.data]);

  const saveInstance = trpc.platform.updateInstanceSettings.useMutation({
    onSuccess: () => {
      toast({ title: "Instance configuration saved" });
      utils.platform.getSettings.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save instance settings",
        description: err.message,
        variant: "destructive",
      }),
  });

  const savePlans = trpc.platform.updatePlanCatalog.useMutation({
    onSuccess: () => {
      toast({ title: "Plan catalog updated successfully" });
      utils.platform.getSettings.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save plans",
        description: err.message,
        variant: "destructive",
      }),
  });

  const saveFlags = trpc.platform.updateDefaultFeatureFlags.useMutation({
    onSuccess: () => {
      toast({ title: "Default feature flags persisted" });
      utils.platform.getSettings.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save feature flags",
        description: err.message,
        variant: "destructive",
      }),
  });

  const updatePlan = (index: number, patch: Partial<PlanDraft>) => {
    setPlans((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );
  };

  const addPlan = () => {
    const id = newPlanId.trim().toUpperCase();
    if (!planIdOk(id)) {
      toast({
        title: "Invalid plan id",
        description: "Use UPPER_SNAKE like TEAM_PLUS (A-Z, 0-9, underscore).",
        variant: "destructive",
      });
      return;
    }
    if (plans.some((p) => p.id === id)) {
      toast({
        title: "Plan already exists",
        description: id,
        variant: "destructive",
      });
      return;
    }
    setPlans((prev) => [
      ...prev,
      {
        id,
        name: id
          .split("_")
          .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
          .join(" "),
        blurb: "",
        seats: "",
        interviews: "",
        projects: "",
        purchaseable: false,
        stripePriceId: "",
        stripePriceEnv: "",
        features: { ...DEFAULT_PLAN_FEATURES },
      },
    ]);
    setNewPlanId("");
  };

  const removePlan = (index: number) => {
    const plan = plans[index];
    if (!plan) return;
    if (PROTECTED_PLAN_IDS.has(plan.id)) {
      toast({
        title: "Protected plan",
        description: `${plan.id} is a platform system required tier and cannot be removed.`,
        variant: "destructive",
      });
      return;
    }
    setPlans((prev) => prev.filter((_, i) => i !== index));
  };

  if (settings.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <PageHeader
        kicker="System Configuration"
        title="Instance Settings & Tiers"
        description="Global tenancy limits, commercial plan catalogs, Stripe pricing hooks, and default organization feature gates."
      />

      {/* Instance Rules Panel */}
      <Panel
        kicker="Tenancy Policy"
        title="Instance Governance"
        description="Global account thresholds applied across all tenants on this server."
      >
        <div className="space-y-4 max-w-xl">
          <label className="block space-y-1.5 text-xs">
            <span className="font-semibold text-foreground">
              Maximum Organizations Per User Account
            </span>
            <Input
              inputMode="numeric"
              value={maxOrgs}
              onChange={(e) => setMaxOrgs(e.target.value)}
              className="h-9 w-40 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80 font-mono"
            />
          </label>

          <div className="space-y-2.5 pt-1">
            <label className="flex items-center gap-3 text-xs font-medium text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border/80 text-primary accent-primary"
                checked={allowSelfDelete}
                onChange={(e) => setAllowSelfDelete(e.target.checked)}
              />
              <span>Allow organization owners to self-delete their organization</span>
            </label>

            <label className="flex items-center gap-3 text-xs font-medium text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border/80 text-primary accent-primary"
                checked={allowBilling}
                onChange={(e) => setAllowBilling(e.target.checked)}
              />
              <span>Enable self-serve Stripe upgrades in tenant billing portal</span>
            </label>
          </div>

          <div className="pt-2">
            <TacticalButton
              size="sm"
              loading={saveInstance.isPending}
              onClick={() =>
                saveInstance.mutate({
                  maxOrgsPerAccount: Math.max(1, Number(maxOrgs) || 1),
                  allowOrgSelfDelete: allowSelfDelete,
                  allowOrgSelfServeBilling: allowBilling,
                })
              }
              className="gap-1.5 text-xs h-8"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save Instance Policy</span>
            </TacticalButton>
          </div>
        </div>
      </Panel>

      {/* Plans Catalog Panel */}
      <Panel
        kicker="Commercial Tiers"
        title="Subscription Plan Catalog"
        description="Quota limits and feature unlocks per tier. Blank limits indicate unlimited quota."
        actions={
          <div className="flex items-center gap-2">
            <Input
              className="h-8 w-36 text-xs uppercase font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
              placeholder="e.g. ENTERPRISE_PRO"
              value={newPlanId}
              onChange={(e) => setNewPlanId(e.target.value.toUpperCase())}
            />
            <TacticalButton
              size="sm"
              variant="outline"
              type="button"
              onClick={addPlan}
              className="h-8 text-xs gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Plan</span>
            </TacticalButton>
          </div>
        }
      >
        <div className="space-y-5">
          {plans.map((plan, index) => {
            const isProtected = PROTECTED_PLAN_IDS.has(plan.id);

            return (
              <div
                key={plan.id}
                className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm dark:border-white/[0.06] dark:bg-zinc-950/40 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3 dark:border-white/[0.04]">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm font-bold text-foreground">
                      {plan.name || plan.id}
                    </span>
                    <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-primary">
                      {plan.id}
                    </span>
                    {isProtected && (
                      <span className="rounded border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                        <Lock className="h-2.5 w-2.5" />
                        System Core
                      </span>
                    )}
                  </div>

                  {!isProtected ? (
                    <TacticalButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 text-xs gap-1"
                      onClick={() => removePlan(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </TacticalButton>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground font-medium">Public Plan Name</span>
                    <Input
                      value={plan.name}
                      onChange={(e) => updatePlan(index, { name: e.target.value })}
                      className="h-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-muted-foreground font-medium">Stripe Price ID (Env / Live)</span>
                    <Input
                      placeholder="price_1N..."
                      value={plan.stripePriceId}
                      onChange={(e) => updatePlan(index, { stripePriceId: e.target.value })}
                      className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                    />
                  </label>
                </div>

                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground font-medium">Short Marketing Tagline</span>
                  <Input
                    value={plan.blurb}
                    onChange={(e) => updatePlan(index, { blurb: e.target.value })}
                    className="h-8 text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                  />
                </label>

                {/* Quotas */}
                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["Member Seats", "seats"],
                      ["Interviews / Month", "interviews"],
                      ["Allowed Projects", "projects"],
                    ] as const
                  ).map(([label, key]) => (
                    <label key={key} className="space-y-1 text-xs">
                      <span className="text-muted-foreground font-medium">{label}</span>
                      <Input
                        inputMode="numeric"
                        placeholder="Unlimited"
                        value={plan[key]}
                        onChange={(e) => updatePlan(index, { [key]: e.target.value })}
                        className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                      />
                    </label>
                  ))}
                </div>

                <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border/80 text-primary accent-primary"
                    checked={plan.purchaseable}
                    onChange={(e) => updatePlan(index, { purchaseable: e.target.checked })}
                  />
                  <span>Purchaseable directly by organizations in billing checkout</span>
                </label>

                {/* Feature Matrix for this plan */}
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3 dark:border-white/[0.04]">
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Included Capabilities
                  </p>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {FEATURE_FLAG_META.map((item) => (
                      <li key={item.key} className="flex items-start gap-2.5 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 rounded border-border/80 text-primary accent-primary"
                          checked={Boolean(plan.features[item.key])}
                          onChange={(e) =>
                            updatePlan(index, {
                              features: {
                                ...plan.features,
                                [item.key]: e.target.checked,
                              },
                            })
                          }
                        />
                        <div>
                          <p className="font-semibold text-foreground text-xs">{item.label}</p>
                          <p className="text-[10px] text-muted-foreground leading-normal">{item.hint}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-border/50 dark:border-white/[0.06] flex justify-end">
          <TacticalButton
            size="sm"
            loading={savePlans.isPending}
            disabled={savePlans.isPending || plans.length === 0}
            onClick={() => {
              const payload = plans.map(fromDraft);
              for (const p of payload) {
                if (!planIdOk(p.id) || !p.name) {
                  toast({
                    title: "Validation Error",
                    description: "Every plan must contain a valid UPPER_SNAKE ID and non-empty name.",
                    variant: "destructive",
                  });
                  return;
                }
              }
              savePlans.mutate({ plans: payload });
            }}
            className="gap-1.5 text-xs h-9"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save All Plan Configurations</span>
          </TacticalButton>
        </div>
      </Panel>

      {/* Default Feature Flags Panel */}
      <Panel
        kicker="Tenant Bootstrap"
        title="Default Feature Gate Presets"
        description="Features automatically unlocked for newly provisioned organizations prior to plan assignment."
      >
        <div className="space-y-4">
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURE_FLAG_META.map((item) => (
              <li
                key={item.key}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3.5 transition-colors cursor-pointer select-none",
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
                  className="mt-0.5 h-4 w-4 rounded border-border/80 text-primary accent-primary"
                  checked={Boolean(flags[item.key])}
                  onChange={(e) =>
                    setFlags((prev) => ({
                      ...prev,
                      [item.key]: e.target.checked,
                    }))
                  }
                />
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-foreground">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground leading-normal">{item.hint}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="pt-2 flex justify-end">
            <TacticalButton
              size="sm"
              loading={saveFlags.isPending}
              onClick={() =>
                saveFlags.mutate({
                  aiSettings: Boolean(flags.aiSettings),
                  integrations: Boolean(flags.integrations),
                  voiceInterviews: Boolean(flags.voiceInterviews),
                  publicForms: Boolean(flags.publicForms),
                  usageDashboard: Boolean(flags.usageDashboard),
                })
              }
              className="gap-1.5 text-xs h-8"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Persist Default Feature Flags</span>
            </TacticalButton>
          </div>
        </div>
      </Panel>
    </div>
  );
}
