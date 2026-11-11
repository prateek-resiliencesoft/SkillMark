"use client";

import {
  DEFAULT_PLAN_FEATURES,
  PROTECTED_PLAN_IDS,
  planIdOk,
  type PlanCatalogEntry,
  type PlanFeatureFlags,
} from "@/lib/billing/catalog";
import { FEATURE_FLAG_META } from "@/lib/platform-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Plus, Trash2 } from "lucide-react";
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
      toast({ title: "Instance settings saved" });
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
      toast({ title: "Plans saved" });
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
      toast({ title: "Default features saved" });
      utils.platform.getSettings.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save features",
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
        description: `${plan.id} cannot be removed.`,
        variant: "destructive",
      });
      return;
    }
    setPlans((prev) => prev.filter((_, i) => i !== index));
  };

  if (settings.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Config
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Instance defaults, editable plans (limits + features + Stripe), and
          feature flags new organizations inherit.
        </p>
      </div>

      <section className="space-y-4 rounded-xl border p-5">
        <div>
          <h2 className="text-sm font-medium">Instance</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Global rules for every account on this ResilienceSoft Interview
            instance.
          </p>
        </div>
        <label className="block max-w-xs space-y-1.5 text-xs">
          <span className="text-muted-foreground">
            Max organizations per account
          </span>
          <Input
            inputMode="numeric"
            value={maxOrgs}
            onChange={(e) => setMaxOrgs(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border"
            checked={allowSelfDelete}
            onChange={(e) => setAllowSelfDelete(e.target.checked)}
          />
          Owners can remove their own organization
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border"
            checked={allowBilling}
            onChange={(e) => setAllowBilling(e.target.checked)}
          />
          Owners can self-serve upgrade via Stripe
        </label>
        <Button
          size="sm"
          disabled={saveInstance.isPending}
          onClick={() =>
            saveInstance.mutate({
              maxOrgsPerAccount: Math.max(1, Number(maxOrgs) || 1),
              allowOrgSelfDelete: allowSelfDelete,
              allowOrgSelfServeBilling: allowBilling,
            })
          }
        >
          Save instance
        </Button>
      </section>

      <section className="space-y-4 rounded-xl border p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Plans</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Empty limit = unlimited. Add custom plans anytime. FREE and
              SELF_HOSTED stay required.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="w-40"
              placeholder="TEAM_PLUS"
              value={newPlanId}
              onChange={(e) => setNewPlanId(e.target.value.toUpperCase())}
            />
            <Button size="sm" variant="outline" type="button" onClick={addPlan}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add plan
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {plans.map((plan, index) => (
            <div key={plan.id} className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{plan.name || plan.id}</p>
                  <Badge variant="outline" className="text-[10px]">
                    {plan.id}
                  </Badge>
                  {PROTECTED_PLAN_IDS.has(plan.id) ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Required
                    </Badge>
                  ) : null}
                </div>
                {!PROTECTED_PLAN_IDS.has(plan.id) ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removePlan(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs">
                  <span className="text-muted-foreground">Display name</span>
                  <Input
                    value={plan.name}
                    onChange={(e) =>
                      updatePlan(index, { name: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1.5 text-xs">
                  <span className="text-muted-foreground">Stripe price id</span>
                  <Input
                    placeholder="price_..."
                    value={plan.stripePriceId}
                    onChange={(e) =>
                      updatePlan(index, { stripePriceId: e.target.value })
                    }
                  />
                </label>
              </div>

              <label className="block space-y-1.5 text-xs">
                <span className="text-muted-foreground">Blurb</span>
                <Input
                  value={plan.blurb}
                  onChange={(e) => updatePlan(index, { blurb: e.target.value })}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["Seats", "seats"],
                    ["Interviews", "interviews"],
                    ["Projects", "projects"],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key} className="space-y-1.5 text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <Input
                      inputMode="numeric"
                      placeholder="Unlimited"
                      value={plan[key]}
                      onChange={(e) =>
                        updatePlan(index, { [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border"
                  checked={plan.purchaseable}
                  onChange={(e) =>
                    updatePlan(index, { purchaseable: e.target.checked })
                  }
                />
                Purchaseable via Stripe (needs a price id or env mapping)
              </label>

              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Plan features
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {FEATURE_FLAG_META.map((item) => (
                    <li key={item.key} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border"
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
                        <p className="text-sm">{item.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {item.hint}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        <Button
          size="sm"
          disabled={savePlans.isPending || plans.length === 0}
          onClick={() => {
            const payload = plans.map(fromDraft);
            for (const p of payload) {
              if (!planIdOk(p.id) || !p.name) {
                toast({
                  title: "Fix plan fields",
                  description: "Every plan needs a valid id and name.",
                  variant: "destructive",
                });
                return;
              }
            }
            savePlans.mutate({ plans: payload });
          }}
        >
          Save plans
        </Button>
      </section>

      <section className="space-y-4 rounded-xl border p-5">
        <div>
          <h2 className="text-sm font-medium">Default features (new orgs)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Applied when a new organization is created. Assigning a plan in the
            org admin page can overwrite these with that plan&apos;s features.
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
          disabled={saveFlags.isPending}
          onClick={() =>
            saveFlags.mutate({
              aiSettings: Boolean(flags.aiSettings),
              integrations: Boolean(flags.integrations),
              voiceInterviews: Boolean(flags.voiceInterviews),
              publicForms: Boolean(flags.publicForms),
              usageDashboard: Boolean(flags.usageDashboard),
            })
          }
        >
          Save default features
        </Button>
      </section>
    </div>
  );
}
