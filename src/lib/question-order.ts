/**
 * Canonical order for the general / HR block of an interview, so the
 * interviewer always asks in the same sensible sequence:
 *   intro → current CTC → expected CTC → notice period → current location /
 *   address → relocation → bond / commitment → any other general question,
 * and only then the AI-generated technical questions.
 *
 * Pure and dependency free (also used by question-conditions). Matching is on
 * the question text because the question bank has no stable keys.
 */

export const GENERAL_RANK = {
  intro: 0,
  currentCtc: 1,
  expectedCtc: 2,
  noticePeriod: 3,
  location: 4,
  relocation: 5,
  bond: 6,
  other: 7,
} as const;

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MONEY = /\b(ctc|salary|compensation|package|lpa|lakhs?|lacs?|pay|remuneration)\b/;
const EXPECTED = /\b(expected|expecting|expectations?|expect|desired|ectc)\b/;
const NOTICE = /\bnotice\b|how soon .*\bjoin|earliest .*\bjoin|joining (date|time)|last working day|serving (your )?notice/;
const RELOCATE = /\brelocat|\b(willing|open|ready) to (move|shift|work from)|move to (another|a different|our)/;
const BOND = /\bbond\b|\bcommitment\b|commit (to|for)|service (agreement|bond)|minimum (tenure|commitment|stay)|lock in|\b(1|one|2|two|3|three) years? (bond|commitment|service|tenure|contract)/;
const LOCATION = /\b(location|address|city|reside|residence|live|living|based|hometown|native|stay|staying)\b/;
const INTRO = /about yourself|introduce yourself|self introduction|your (full )?name\b|what is your name|may i know your name|your introduction|an? (brief |short )?(intro|introduction)\b|walk me through your (background|profile|journey)|^intro(duction)?\b/;

/** Position of a general question in the canonical order (lower = earlier). */
export function generalQuestionRank(text: string): number {
  const t = norm(text);
  if (!t) return GENERAL_RANK.other;
  if (INTRO.test(t)) return GENERAL_RANK.intro;
  if (MONEY.test(t)) return EXPECTED.test(t) ? GENERAL_RANK.expectedCtc : GENERAL_RANK.currentCtc;
  if (NOTICE.test(t)) return GENERAL_RANK.noticePeriod;
  if (RELOCATE.test(t)) return GENERAL_RANK.relocation;
  if (BOND.test(t)) return GENERAL_RANK.bond;
  if (LOCATION.test(t)) return GENERAL_RANK.location;
  return GENERAL_RANK.other;
}

/** Stable sort of a general block into the canonical order. Unknown questions keep their relative order after the known ones. */
export function sortGeneralQuestions<T extends { text: string }>(general: T[]): T[] {
  return general
    .map((q, i) => ({ q, i, r: generalQuestionRank(q.text) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.q);
}

/**
 * General block in canonical order, then the complementary (AI-generated)
 * questions. If the general block has no intro but the AI wrote one, that
 * intro is moved to the very top so the interview always opens with it.
 */
export function orderGeneralFirst<T extends { text: string }>(general: T[], complementary: T[]): T[] {
  const hasIntro = general.some((q) => generalQuestionRank(q.text) === GENERAL_RANK.intro);
  let rest = complementary;
  let pulled: T[] = [];
  if (!hasIntro) {
    const i = complementary.findIndex((q) => generalQuestionRank(q.text) === GENERAL_RANK.intro);
    if (i >= 0) {
      pulled = [complementary[i]];
      rest = complementary.filter((_, k) => k !== i);
    }
  }
  return [...sortGeneralQuestions([...pulled, ...general]), ...rest];
}
