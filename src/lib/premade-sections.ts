import { parseSkipIf, type QuestionSkipIf } from "@/lib/question-conditions";

/** Map interview type → question-bank section name keywords. */
const TYPE_KEYWORDS: Record<string, string[]> = {
  screening: ["screen"],
  technical: ["tech"],
  behavioral: ["hr", "behav", "culture", "soft"],
  mixed: [],
};

export type PremadeBankQuestion = {
  id: string;
  sectionId: string;
  sectionName: string;
  text: string;
  type?: string | null;
  description?: string | null;
  options?: unknown;
  starterCode?: unknown;
  skipIf?: QuestionSkipIf | null;
};

/** Shape of `questionBank.list` rows (sections + nested items). */
export type BankListSection = {
  id: string;
  name: string;
  order: number;
  isEnabled: boolean;
  items?: Array<{
    id: string;
    sectionId: string;
    text: string;
    type?: string | null;
    description?: string | null;
    options?: unknown;
    starterCode?: unknown;
    skipIf?: unknown;
    isEnabled?: boolean;
    order?: number;
  }>;
};

/** Enabled rounds + questions from `questionBank.list` (Questions-page parity). */
export function flattenEnabledBankList(rows: BankListSection[] | undefined | null): {
  sections: Array<{ id: string; name: string; order: number; isEnabled: boolean }>;
  questions: PremadeBankQuestion[];
} {
  const enabledSecs = [...(rows ?? [])]
    .filter((s) => s.isEnabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const questions: PremadeBankQuestion[] = [];
  for (const sec of enabledSecs) {
    const items = [...(sec.items ?? [])]
      .filter((i) => i.isEnabled !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const q of items) {
      questions.push({
        id: q.id,
        sectionId: sec.id,
        sectionName: sec.name,
        text: q.text,
        type: q.type ?? "OPEN_ENDED",
        description: q.description ?? null,
        options: q.options ?? null,
        starterCode: q.starterCode ?? null,
        skipIf: parseSkipIf(q.skipIf),
      });
    }
  }
  return {
    sections: enabledSecs.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      isEnabled: s.isEnabled,
    })),
    questions,
  };
}

export function sectionsMatchingInterviewType<T extends { id: string; name: string }>(
  interviewType: string | undefined,
  sections: T[],
): T[] {
  const keys = TYPE_KEYWORDS[interviewType ?? ""] ?? [];
  if (!keys.length) return sections;
  const matched = sections.filter((s) =>
    keys.some((k) => s.name.toLowerCase().includes(k)),
  );
  return matched.length ? matched : sections;
}

/**
 * Any Round Preset / bank Q (non-empty sectionName) is out of overall score.
 * Empty/missing sectionName = genuine AI complementary Q → scored.
 */
export function shouldExcludePremadeFromScore(
  sectionName: string | null | undefined,
): boolean {
  return (sectionName ?? "").trim().length > 0;
}

/** Parse `validationRules.excludeFromScore` stamped at question insert. */
export function hasExcludeFromScoreFlag(validationRules: unknown): boolean {
  if (!validationRules || typeof validationRules !== "object" || Array.isArray(validationRules)) {
    return false;
  }
  return (validationRules as { excludeFromScore?: unknown }).excludeFromScore === true;
}

/** Stamp for all premade bank rows (reuse questions.validationRules jsonb). */
export function excludeFromScoreValidationRules(
  sectionName: string | null | undefined,
): { excludeFromScore: true } | null {
  return shouldExcludePremadeFromScore(sectionName) ? { excludeFromScore: true } : null;
}

const FROM_SECTION_RE = /^From (.+) section$/i;

/**
 * Texts that must not contribute to overall score: stamped flag, "From X section"
 * description, or any premade bank row with a section name.
 */
export function collectExcludedScoreTexts(
  questions: Array<{
    text?: string | null;
    description?: string | null;
    validationRules?: unknown;
  }> | null | undefined,
  premade: Array<{ text?: string | null; sectionName?: string | null }> | null | undefined,
): string[] {
  const out: string[] = [];
  for (const q of questions ?? []) {
    const text = typeof q.text === "string" ? q.text.trim() : "";
    if (!text) continue;
    if (hasExcludeFromScoreFlag(q.validationRules)) {
      out.push(text);
      continue;
    }
    const desc = typeof q.description === "string" ? q.description.trim() : "";
    const m = desc.match(FROM_SECTION_RE);
    if (m?.[1] && shouldExcludePremadeFromScore(m[1])) out.push(text);
  }
  for (const p of premade ?? []) {
    const text = typeof p.text === "string" ? p.text.trim() : "";
    if (!text) continue;
    if (shouldExcludePremadeFromScore(p.sectionName)) out.push(text);
  }
  return out;
}

export type PremadeQuestionPayload = {
  text: string;
  type?: string;
  sectionName: string;
  description?: string;
  options?: unknown;
  starterCode?: unknown;
  skipIf?: QuestionSkipIf;
};

export function toPremadePayload(questions: PremadeBankQuestion[]): PremadeQuestionPayload[] {
  return questions.map((q) => ({
    text: q.text,
    type: q.type ?? undefined,
    sectionName: q.sectionName,
    description: q.description ?? undefined,
    options: q.options ?? undefined,
    starterCode: q.starterCode ?? undefined,
    skipIf: q.skipIf ?? undefined,
  }));
}
