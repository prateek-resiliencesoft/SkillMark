import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_TRIAGE_SETTINGS, type BugTriageSettings } from "./types";

const TABLE = "bug_triage_settings";

function rowToSettings(row: Record<string, unknown> | null | undefined): BugTriageSettings {
  if (!row) return { ...DEFAULT_TRIAGE_SETTINGS };
  return {
    enabled: row.enabled !== false,
    errorThreshold: Math.max(1, Number(row.errorThreshold) || DEFAULT_TRIAGE_SETTINGS.errorThreshold),
    noiseThreshold: Math.max(1, Number(row.noiseThreshold) || DEFAULT_TRIAGE_SETTINGS.noiseThreshold),
    windowDays: Math.min(90, Math.max(1, Number(row.windowDays) || DEFAULT_TRIAGE_SETTINGS.windowDays)),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
  };
}

export async function loadBugTriageSettings(): Promise<BugTriageSettings> {
  try {
    const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", 1).maybeSingle();
    if (error) {
      if (isMissingTable(error)) return { ...DEFAULT_TRIAGE_SETTINGS };
      throw error;
    }
    return rowToSettings(data as Record<string, unknown> | null);
  } catch {
    return { ...DEFAULT_TRIAGE_SETTINGS };
  }
}

export async function saveBugTriageSettings(
  patch: Partial<Pick<BugTriageSettings, "enabled" | "errorThreshold" | "noiseThreshold" | "windowDays">>,
): Promise<BugTriageSettings> {
  const current = await loadBugTriageSettings();
  const next = {
    enabled: patch.enabled ?? current.enabled,
    errorThreshold: Math.max(1, patch.errorThreshold ?? current.errorThreshold),
    noiseThreshold: Math.max(1, patch.noiseThreshold ?? current.noiseThreshold),
    windowDays: Math.min(90, Math.max(1, patch.windowDays ?? current.windowDays)),
    updatedAt: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .upsert({ id: 1, ...next }, { onConflict: "id" })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return rowToSettings(data as Record<string, unknown> | null);
}

function isMissingTable(err: { code?: string; message?: string }): boolean {
  return err.code === "42P01" || /relation .* does not exist/i.test(err.message ?? "");
}
