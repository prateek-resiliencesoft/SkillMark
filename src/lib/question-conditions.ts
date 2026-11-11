import { z } from "zod";

/**
 * Conditional skip rules for interview / bank questions.
 * Example: skip "Where do you live?" if intro already mentioned location.
 */
export type QuestionSkipIf = {
  /** Case-insensitive: skip when any prior USER answer contains any keyword. */
  answerContainsAny?: string[];
  /** Short label shown in UI / reports. */
  reason?: string;
};

/** Shared Zod schema for bank + interview question skipIf. */
export const questionSkipIfSchema = z
  .object({
    answerContainsAny: z.array(z.string().trim().min(1)).max(20).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .nullable()
  .optional();

export const skipIfSchemaShape = {
  answerContainsAny: true as const,
  reason: true as const,
};

export function parseSkipIf(raw: unknown): QuestionSkipIf | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const keywords = Array.isArray(o.answerContainsAny)
    ? o.answerContainsAny.map((k) => String(k).trim()).filter(Boolean)
    : [];
  if (!keywords.length && !o.reason) return null;
  return {
    answerContainsAny: keywords.length ? keywords : undefined,
    reason: typeof o.reason === "string" ? o.reason : undefined,
  };
}

export function normalizeMatchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when this question should be skipped given prior user answers. */
export function shouldSkipQuestion(
  skipIf: unknown,
  priorUserAnswers: string[],
): boolean {
  const rule = parseSkipIf(skipIf);
  if (!rule?.answerContainsAny?.length) return false;
  const haystack = normalizeMatchText(priorUserAnswers.join("\n"));
  if (!haystack) return false;
  return rule.answerContainsAny.some((kw) => {
    const needle = normalizeMatchText(kw);
    return needle.length > 0 && haystack.includes(needle);
  });
}

/** Next index >= from that is not skipped (or length if none). */
export function nextAskableQuestionIndex(
  questions: { skipIf?: unknown }[],
  fromIndex: number,
  priorUserAnswers: string[],
): number {
  let i = Math.max(0, fromIndex);
  while (i < questions.length && shouldSkipQuestion(questions[i]?.skipIf, priorUserAnswers)) {
    i += 1;
  }
  return i;
}

/** Soft overlap: generated text is a rewording of premade → replace with exact. */
export function textsOverlap(a: string, b: string): boolean {
  const na = normalizeMatchText(a);
  const nb = normalizeMatchText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 24 && longer.includes(shorter)) return true;
  // token Jaccard
  const ta = new Set(na.split(" ").filter((w) => w.length > 2));
  const tb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.72;
}

export type PremadeExact = {
  text: string;
  type?: string;
  sectionName?: string;
  description?: string;
  options?: unknown;
  starterCode?: unknown;
  skipIf?: QuestionSkipIf | null;
};

/**
 * Ensure every premade appears with EXACT wording, listed FIRST (screening /
 * auto-include rounds before AI complementary Qs). Reworded near-duplicates
 * from the model are dropped; missing premade are inserted.
 */
export function enforceExactPremadeQuestions<
  T extends {
    text: string;
    type?: string;
    description?: string;
    options?: unknown;
    starterCode?: unknown;
    isRequired?: boolean;
    order?: number;
    skipIf?: unknown;
  },
>(questions: T[], premade: PremadeExact[]): T[] {
  if (!premade.length) return questions;

  const premadeExact: T[] = [];
  const usedGenerated = new Set<number>();

  for (const pm of premade) {
    if (!pm?.text?.trim()) continue;
    let hit = questions.findIndex(
      (q, i) => !usedGenerated.has(i) && textsOverlap(q.text, pm.text),
    );
    if (hit < 0) {
      hit = questions.findIndex(
        (q, i) =>
          !usedGenerated.has(i) &&
          normalizeMatchText(q.text) === normalizeMatchText(pm.text),
      );
    }
    if (hit >= 0) {
      usedGenerated.add(hit);
      premadeExact.push({
        ...questions[hit],
        text: pm.text,
        type: (pm.type as T["type"]) || questions[hit].type,
        description: pm.description || questions[hit].description,
        options: (pm.options as T["options"]) ?? questions[hit].options,
        starterCode: (pm.starterCode as T["starterCode"]) ?? questions[hit].starterCode,
        skipIf: pm.skipIf ?? questions[hit].skipIf,
      });
    } else {
      premadeExact.push({
        order: premadeExact.length,
        text: pm.text,
        type: (pm.type as T["type"]) || ("OPEN_ENDED" as T["type"]),
        description: pm.description || `From ${pm.sectionName || "Premade"} section`,
        isRequired: true,
        options: pm.options as T["options"],
        starterCode: pm.starterCode as T["starterCode"],
        skipIf: pm.skipIf ?? null,
      } as T);
    }
  }

  const complementary = questions.filter((_, i) => !usedGenerated.has(i));
  return [...premadeExact, ...complementary].map((q, i) => ({ ...q, order: i }));
}
