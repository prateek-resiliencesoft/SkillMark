export const REJECT_TAG_PRESETS = [
  { id: "cheating", label: "Cheating" },
  { id: "low_score", label: "Low score" },
  { id: "incomplete", label: "Incomplete" },
  { id: "integrity", label: "Integrity" },
  { id: "culture_fit", label: "Culture fit" },
  { id: "other", label: "Other" },
] as const;

export type RejectPresetId = (typeof REJECT_TAG_PRESETS)[number]["id"];

const PRESET_LABEL = Object.fromEntries(REJECT_TAG_PRESETS.map((p) => [p.id, p.label])) as Record<
  string,
  string
>;

const MAX_TAG_LEN = 40;
const MAX_TAGS = 12;

/** Trim, dedupe, cap length/count. Preserves preset ids and custom strings. */
export function normalizeRejectTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().slice(0, MAX_TAG_LEN);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function rejectTagLabel(tag: string): string {
  return PRESET_LABEL[tag] ?? tag;
}
