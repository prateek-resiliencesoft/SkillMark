/**
 * Platform (instance) settings stored in `platform_settings`.
 * Hardcoded catalog remains the fallback when DB rows are missing.
 */
import {
  DEFAULT_PLAN_CATALOG,
  DEFAULT_PLAN_FEATURES,
  limitsFromCatalog,
  planIdOk,
  type OrgLimits,
  type PlanCatalogEntry,
  type PlanFeatureFlags,
} from "@/lib/billing/catalog";

export const PLATFORM_SETTING_KEYS = [
  "instance",
  "planLimits",
  "planCatalog",
  "defaultFeatureFlags",
] as const;

export type PlatformSettingKey = (typeof PLATFORM_SETTING_KEYS)[number];

export type InstanceSettings = {
  maxOrgsPerAccount: number;
  allowOrgSelfDelete: boolean;
  allowOrgSelfServeBilling: boolean;
};

export type PlanLimitsMap = Record<string, OrgLimits>;

export type DefaultFeatureFlags = PlanFeatureFlags;

export type PlatformSettingsBundle = {
  instance: InstanceSettings;
  planCatalog: PlanCatalogEntry[];
  /** Derived from planCatalog for quota lookups. */
  planLimits: PlanLimitsMap;
  defaultFeatureFlags: DefaultFeatureFlags;
};

export const FEATURE_FLAG_META: {
  key: keyof DefaultFeatureFlags;
  label: string;
  hint: string;
}[] = [
  {
    key: "aiSettings",
    label: "AI settings",
    hint: "Org can manage provider keys and routing",
  },
  {
    key: "integrations",
    label: "Integrations",
    hint: "Email, WhatsApp, webhooks, forms",
  },
  {
    key: "voiceInterviews",
    label: "Voice interviews",
    hint: "Allow voice-enabled interview sessions",
  },
  {
    key: "publicForms",
    label: "Public forms",
    hint: "Hosted application forms",
  },
  {
    key: "usageDashboard",
    label: "Usage dashboard",
    hint: "Org usage page",
  },
];

export function defaultInstanceSettings(): InstanceSettings {
  return {
    maxOrgsPerAccount: 10,
    allowOrgSelfDelete: true,
    allowOrgSelfServeBilling: true,
  };
}

export function defaultPlanLimitsMap(): PlanLimitsMap {
  return limitsFromCatalog(DEFAULT_PLAN_CATALOG);
}

export function defaultFeatureFlags(): DefaultFeatureFlags {
  return { ...DEFAULT_PLAN_FEATURES };
}

export function defaultPlatformSettings(): PlatformSettingsBundle {
  const planCatalog = DEFAULT_PLAN_CATALOG.map((p) => ({
    ...p,
    limits: { ...p.limits },
    features: { ...p.features },
  }));
  return {
    instance: defaultInstanceSettings(),
    planCatalog,
    planLimits: limitsFromCatalog(planCatalog),
    defaultFeatureFlags: defaultFeatureFlags(),
  };
}

function asLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return undefined;
}

export function parseInstanceSettings(raw: unknown): InstanceSettings {
  const base = defaultInstanceSettings();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const max = asLimit(o.maxOrgsPerAccount);
  return {
    maxOrgsPerAccount:
      typeof max === "number" && max >= 1 ? max : base.maxOrgsPerAccount,
    allowOrgSelfDelete:
      typeof o.allowOrgSelfDelete === "boolean"
        ? o.allowOrgSelfDelete
        : base.allowOrgSelfDelete,
    allowOrgSelfServeBilling:
      typeof o.allowOrgSelfServeBilling === "boolean"
        ? o.allowOrgSelfServeBilling
        : base.allowOrgSelfServeBilling,
  };
}

export function parseFeatureFlags(
  raw: unknown,
  fallback: PlanFeatureFlags = DEFAULT_PLAN_FEATURES,
): PlanFeatureFlags {
  const base = { ...fallback };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof PlanFeatureFlags)[]) {
    if (typeof o[key] === "boolean") base[key] = o[key] as boolean;
  }
  return base;
}

export function parseDefaultFeatureFlags(raw: unknown): DefaultFeatureFlags {
  return parseFeatureFlags(raw, defaultFeatureFlags());
}

function parseLimitsObject(raw: unknown, fallback: OrgLimits): OrgLimits {
  const next = { ...fallback };
  if (!raw || typeof raw !== "object") return next;
  const r = raw as Record<string, unknown>;
  for (const k of ["seats", "interviews", "projects"] as const) {
    const parsed = asLimit(r[k]);
    if (parsed !== undefined) next[k] = parsed;
  }
  return next;
}

/** Accept planCatalog array; fall back to DEFAULT + optional legacy planLimits. */
export function parsePlanCatalog(
  rawCatalog: unknown,
  legacyLimits?: unknown,
): PlanCatalogEntry[] {
  const base = DEFAULT_PLAN_CATALOG.map((p) => ({
    ...p,
    limits: { ...p.limits },
    features: { ...p.features },
  }));

  if (Array.isArray(rawCatalog) && rawCatalog.length > 0) {
    const out: PlanCatalogEntry[] = [];
    const seen = new Set<string>();
    for (const row of rawCatalog) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? "")
        .trim()
        .toUpperCase();
      if (!planIdOk(id) || seen.has(id)) continue;
      seen.add(id);
      const builtin = base.find((p) => p.id === id);
      const name = String(r.name ?? builtin?.name ?? id).trim() || id;
      const blurb = String(r.blurb ?? builtin?.blurb ?? "").trim();
      out.push({
        id,
        name,
        blurb,
        limits: parseLimitsObject(
          r.limits,
          builtin?.limits ?? { seats: null, interviews: null, projects: null },
        ),
        purchaseable: typeof r.purchaseable === "boolean" ? r.purchaseable : false,
        stripePriceId:
          typeof r.stripePriceId === "string" && r.stripePriceId.trim()
            ? r.stripePriceId.trim()
            : null,
        stripePriceEnv:
          typeof r.stripePriceEnv === "string" && r.stripePriceEnv.trim()
            ? r.stripePriceEnv.trim()
            : builtin?.stripePriceEnv ?? null,
        features: parseFeatureFlags(r.features, builtin?.features ?? DEFAULT_PLAN_FEATURES),
      });
    }
    if (out.length > 0) return out;
  }

  // Legacy: only planLimits map existed — merge limits onto defaults.
  if (legacyLimits && typeof legacyLimits === "object") {
    const lim = legacyLimits as Record<string, unknown>;
    return base.map((p) => ({
      ...p,
      limits: parseLimitsObject(lim[p.id], p.limits),
    }));
  }

  return base;
}

export function parsePlanLimitsMap(raw: unknown): PlanLimitsMap {
  return limitsFromCatalog(parsePlanCatalog(null, raw));
}
