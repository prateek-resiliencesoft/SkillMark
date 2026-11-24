import { normalizeRejectTags, rejectTagLabel } from "@/lib/reject-tags";

const MAX_REASON = 1000;

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

export const DRAFT_REJECT_REASON_MAX = MAX_REASON;
