import { parseSkipIf, type PremadeExact } from "@/lib/question-conditions";

/**
 * Load enabled Question Bank items from enabled (Auto-include) sections.
 * Used when batch settings omit premadeQuestions so screening / bank Qs
 * still land in generated interviews.
 */
export async function loadAutoIncludePremade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string,
): Promise<PremadeExact[]> {
  const { data: sections, error: secErr } = await supabase
    .from("question_bank_sections")
    .select("id, name, order")
    .eq("organizationId", organizationId)
    .eq("isEnabled", true)
    .order("order", { ascending: true });

  if (secErr || !sections?.length) return [];

  const typedSections = sections as Array<{ id: string; name: string }>;
  const sectionIds = typedSections.map((s) => s.id);
  const secMap = new Map<string, string>(
    typedSections.map((s) => [s.id, s.name]),
  );

  const { data: items, error: itemsErr } = await supabase
    .from("question_bank_items")
    .select(
      "text, type, description, options, starterCode, skipIf, sectionId, order",
    )
    .in("sectionId", sectionIds)
    .eq("isEnabled", true)
    .order("order", { ascending: true });

  if (itemsErr || !items?.length) return [];

  return (
    items as Array<{
      text: string;
      type?: string | null;
      description?: string | null;
      options?: unknown;
      starterCode?: unknown;
      skipIf?: unknown;
      sectionId: string;
    }>
  ).map((q) => ({
    text: q.text,
    type: q.type ?? "OPEN_ENDED",
    sectionName: secMap.get(q.sectionId) ?? "Premade",
    description: q.description ?? undefined,
    options: q.options ?? undefined,
    starterCode: q.starterCode ?? undefined,
    skipIf: parseSkipIf(q.skipIf),
  }));
}

/** Prefer explicit batch picks; fall back to Auto-include bank. */
export async function resolvePremadeQuestions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string,
  fromSettings: PremadeExact[] | null | undefined,
): Promise<PremadeExact[]> {
  if (Array.isArray(fromSettings) && fromSettings.length > 0) {
    return fromSettings.map((p) => ({
      ...p,
      skipIf: parseSkipIf(p.skipIf) ?? p.skipIf ?? null,
    }));
  }
  return loadAutoIncludePremade(supabase, organizationId);
}
