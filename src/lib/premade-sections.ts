/** Map interview type → question-bank section name keywords. */
const TYPE_KEYWORDS: Record<string, string[]> = {
  screening: ["screen"],
  technical: ["tech"],
  behavioral: ["hr", "behav", "culture", "soft"],
  mixed: [],
};

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

export type PremadeBankQuestion = {
  id: string;
  sectionId: string;
  sectionName: string;
  text: string;
  type?: string | null;
  description?: string | null;
  options?: unknown;
  starterCode?: unknown;
  skipIf?: { answerContainsAny?: string[]; reason?: string } | null;
};

export function toPremadePayload(questions: PremadeBankQuestion[]) {
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
