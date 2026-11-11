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
