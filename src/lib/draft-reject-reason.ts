import { normalizeRejectTags, rejectTagLabel } from "@/lib/reject-tags";

const MAX_REASON = 1000;

/** Polite candidate-facing lines when org AI keys are down (quota / 503). */
const TAG_FALLBACK_REASON: Record<string, string> = {
  cheating:
    "We identified concerns regarding assessment integrity during the selection process.",
  low_score:
    "Your overall assessment results did not meet the threshold required for this role.",
  incomplete:
    "The interview was incomplete, so we are unable to proceed with your application at this time.",
  integrity:
    "We identified concerns related to assessment integrity during the process.",
  culture_fit:
    "We have decided to move forward with candidates whose profiles more closely match our current team needs.",
  other:
    "After careful review, we will not be moving forward with your application for this opportunity.",
};

export function parseDraftRejectReasonInput(input: {
  draft?: string;
  tags?: string[];
}): { draft: string; tags: string[] } {
  const draft = (input.draft ?? "").trim().slice(0, MAX_REASON);
  const tags = normalizeRejectTags(input.tags ?? []);
  if (!draft && tags.length === 0) {
    throw new Error("Provide a reason draft and/or tags");
  }
  return { draft, tags };
}

export function buildDraftRejectReasonPrompt(draft: string, tags: string[]): string {
  const tagLine = tags.length
    ? `Tags: ${tags.map((t) => rejectTagLabel(t)).join(", ")}`
    : "Tags: (none)";
  const draftLine = draft
    ? `Rough draft:\n${draft}`
    : "Rough draft: (none — invent a polite reason from the tags only)";
  return `You write one short rejection reason for a job candidate email.
Rules:
- Output ONLY the reason sentence(s), no greeting, no sign-off, no quotes.
- Polite, professional, candidate-friendly. No insults, no PII invention.
- 1-2 sentences, max ~400 characters.
- Suitable to insert after: "we will not be moving forward with your application."
${tagLine}
${draftLine}`;
}

/**
 * Local draft when every AI key fails. Prefer the recruiter's typed text;
 * otherwise compose from known reject tags.
 */
export function fallbackDraftRejectReason(draft: string, tags: string[]): string {
  if (draft.trim()) return draft.trim().slice(0, MAX_REASON);
  const lines = tags
    .map((t) => TAG_FALLBACK_REASON[t] ?? `We noted concerns related to ${rejectTagLabel(t).toLowerCase()}.`)
    .filter(Boolean);
  const unique = [...new Set(lines)].slice(0, 2);
  return (unique.join(" ") || TAG_FALLBACK_REASON.other).slice(0, MAX_REASON);
}

export const DRAFT_REJECT_REASON_MAX = MAX_REASON;
