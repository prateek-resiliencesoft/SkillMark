"use client";

import { FEATURE_FLAG_META } from "@/lib/platform-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { PLAN_CATALOG } from "@/lib/billing/catalog";
import { trpc } from "@/lib/trpc/client";
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

export default function AdminConfigPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const settings = trpc.platform.getSettings.useQuery(undefined, {
    staleTime: 5_000,
  });

  const [maxOrgs, setMaxOrgs] = useState("10");
  const [allowSelfDelete, setAllowSelfDelete] = useState(true);
  const [allowBilling, setAllowBilling] = useState(true);
  const [planLimits, setPlanLimits] = useState<
    Record<string, { seats: string; interviews: string; projects: string }>
  >({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!settings.data) return;
    setMaxOrgs(String(settings.data.instance.maxOrgsPerAccount));
    setAllowSelfDelete(settings.data.instance.allowOrgSelfDelete);
    setAllowBilling(settings.data.instance.allowOrgSelfServeBilling);
    const next: Record<
      string,
      { seats: string; interviews: string; projects: string }
    > = {};
    for (const plan of PLAN_CATALOG) {
      const lim = settings.data.planLimits[plan.id];
      next[plan.id] = {
        seats: limitField(lim.seats),
        interviews: limitField(lim.interviews),
        projects: limitField(lim.projects),
      };
    }
    setPlanLimits(next);
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

  const savePlans = trpc.platform.updatePlanLimits.useMutation({
    onSuccess: () => {
      toast({ title: "Plan limits saved" });
      utils.platform.getSettings.invalidate();
      utils.platform.recentAudit.invalidate();
    },
    onError: (err) =>
      toast({
        title: "Could not save plan limits",
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
          Instance defaults that drive the user panel — org caps, plan quotas,
          and features new organizations inherit.
        </p>
      </div>

      <section className="space-y-4 rounded-xl border p-5">
        <div>
          <h2 className="text-sm font-medium">Instance</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Global rules for every account on this ResilienceSoft Interview instance.
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
        <div>
          <h2 className="text-sm font-medium">Plan limits</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Empty field = unlimited. Per-organization overrides still win on the
            org detail page.
          </p>
        </div>
        <div className="space-y-4">
          {PLAN_CATALOG.map((plan) => {
            const row = planLimits[plan.id] ?? {
              seats: "",
              interviews: "",
              projects: "",
            };
            return (
              <div key={plan.id} className="rounded-lg border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <p className="text-sm font-medium">{plan.name}</p>
                  <Badge variant="outline" className="text-[10px]">
                    {plan.id}
                  </Badge>
                </div>
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
                        value={row[key]}
                        onChange={(e) =>
                          setPlanLimits((prev) => ({
                            ...prev,
                            [plan.id]: { ...row, [key]: e.target.value },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <Button
          size="sm"
          disabled={savePlans.isPending}
          onClick={() => {
            const payload = Object.fromEntries(
              PLAN_CATALOG.map((plan) => {
                const row = planLimits[plan.id] ?? {
                  seats: "",
                  interviews: "",
                  projects: "",
                };
                return [
                  plan.id,
                  {
                    seats: parseLimit(row.seats),
                    interviews: parseLimit(row.interviews),
                    projects: parseLimit(row.projects),
                  },
                ];
              }),
            );
            savePlans.mutate({ planLimits: payload as never });
          }}
        >
          Save plan limits
        </Button>
      </section>

      <section className="space-y-4 rounded-xl border p-5">
        <div>
          <h2 className="text-sm font-medium">Default features</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Applied when a new organization is created. Existing orgs keep their
            own flags until you change them on the org page.
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
