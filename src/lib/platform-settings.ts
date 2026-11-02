/**
 * Platform (instance) settings stored in `platform_settings`.
 * Hardcoded catalog remains the fallback when DB rows are missing.
 */
import {
  PLAN_CATALOG,
  type OrgLimits,
  type OrgPlanId,
} from "@/lib/billing/catalog";

export const PLATFORM_SETTING_KEYS = [
  "instance",
  "planLimits",
  "defaultFeatureFlags",
] as const;

export type PlatformSettingKey = (typeof PLATFORM_SETTING_KEYS)[number];

export type InstanceSettings = {
  maxOrgsPerAccount: number;
  allowOrgSelfDelete: boolean;
  allowOrgSelfServeBilling: boolean;
};

export type PlanLimitsMap = Record<OrgPlanId, OrgLimits>;

export type DefaultFeatureFlags = {
  aiSettings: boolean;
  integrations: boolean;
  voiceInterviews: boolean;
  publicForms: boolean;
  usageDashboard: boolean;
};

export type PlatformSettingsBundle = {
  instance: InstanceSettings;
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
  return Object.fromEntries(
    PLAN_CATALOG.map((p) => [p.id, { ...p.limits }]),
  ) as PlanLimitsMap;
}

export function defaultFeatureFlags(): DefaultFeatureFlags {
  return {
    aiSettings: true,
    integrations: true,
    voiceInterviews: true,
    publicForms: true,
    usageDashboard: true,
  };
}

export function defaultPlatformSettings(): PlatformSettingsBundle {
  return {
    instance: defaultInstanceSettings(),
    planLimits: defaultPlanLimitsMap(),
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

export function parseInstanceSettings(
  raw: unknown,
): InstanceSettings {
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

export function parsePlanLimitsMap(raw: unknown): PlanLimitsMap {
  const base = defaultPlanLimitsMap();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (const plan of Object.keys(base) as OrgPlanId[]) {
    const row = o[plan];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const next = { ...base[plan] };
    for (const k of ["seats", "interviews", "projects"] as const) {
      const parsed = asLimit(r[k]);
      if (parsed !== undefined) next[k] = parsed;
    }
    base[plan] = next;
  }
  return base;
}

export function parseDefaultFeatureFlags(
  raw: unknown,
): DefaultFeatureFlags {
  const base = defaultFeatureFlags();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof DefaultFeatureFlags)[]) {
    if (typeof o[key] === "boolean") base[key] = o[key] as boolean;
  }
  return base;
}
