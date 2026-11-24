import { normalizeRejectTags, rejectTagLabel } from "@/lib/reject-tags";

const MAX_REASON = 1000;

/** Polite candidate-facing lines when org AI keys are down (quota / 503). */
const TAG_FALLBACK_REASON: Record<string, string> = {
  cheating:
    "Thank you for completing the assessment. After review, we identified concerns regarding assessment integrity, so we will not be moving forward with your application for this role.",
  low_score:
    "Thank you for taking the time to complete the assessment. Your overall results did not meet the threshold required for this role at this time, so we will not be moving forward with your application.",
  incomplete:
    "Thank you for your interest. The interview was incomplete, so we are unable to evaluate your application fully and will not be moving forward at this time.",
  integrity:
    "Thank you for completing the assessment. We identified concerns related to assessment integrity during the process, so we will not be moving forward with your application.",
  culture_fit:
    "Thank you for interviewing with us. After careful consideration, we are moving forward with candidates whose profiles more closely match our current team needs.",
  other:
    "Thank you for your interest in this opportunity. After careful review, we will not be moving forward with your application at this time. We wish you every success in your search.",
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
    ? `Tags (use as theme, do not quote ids): ${tags.map((t) => rejectTagLabel(t)).join(", ")}`
    : "Tags: (none)";
  const draftLine = draft
    ? `Rough notes from recruiter (polish into final copy; do not copy unfinished fragments):\n${draft}`
    : "Rough notes: (none — write a complete polite reason from the tags only)";
  return `You write the rejection reason that a candidate will read in their rejection notice email/WhatsApp.

Rules:
- Output ONLY the finished reason text. No greeting, sign-off, subject line, quotes, labels, or markdown.
- Polite, clear, and professional. No insults, blame, or invented personal details.
- Write 2–3 COMPLETE sentences that each end with a period (or ? / !). Never stop mid-sentence or mid-word.
- Target length: 180–420 characters. Must be at least 120 characters. Do not exceed 500 characters.
- Briefly thank them, state the decision clearly, and (when tags allow) give a soft high-level reason without harsh detail.
- Suitable to stand alone after notifying them we will not move forward.

${tagLine}
${draftLine}`;
}

/**
 * Drop a trailing truncated clause so the UI never shows mid-sentence cutoffs
 * like "your final score did".
 */
export function finalizeDraftRejectReason(raw: string): string {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_REASON);

  if (!text) return "";

  if (!/[.!?]$/.test(text)) {
    const lastStop = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
    if (lastStop >= 80) {
      text = text.slice(0, lastStop + 1).trim();
    }
  }

  return text.slice(0, MAX_REASON);
}

/**
 * Local draft when every AI key fails. Prefer the recruiter's typed text;
 * otherwise compose from known reject tags.
 */
export function fallbackDraftRejectReason(draft: string, tags: string[]): string {
  const cleaned = finalizeDraftRejectReason(draft);
  if (cleaned.length >= 40 && /[.!?]$/.test(cleaned)) return cleaned;
  if (cleaned.length >= 40) {
    // Recruiter typed something incomplete — still prefer it over ignoring them,
    // but append a closing sentence so the notice is not a fragment.
    return `${cleaned.replace(/[.!?,;:\s]+$/, "")}. We will not be moving forward with your application at this time.`.slice(
      0,
      MAX_REASON,
    );
  }
  const lines = tags
    .map((t) => TAG_FALLBACK_REASON[t] ?? `Thank you for your interest. We noted concerns related to ${rejectTagLabel(t).toLowerCase()}, so we will not be moving forward with your application.`)
    .filter(Boolean);
  const unique = [...new Set(lines)].slice(0, 2);
  return finalizeDraftRejectReason(unique.join(" ") || TAG_FALLBACK_REASON.other);
}

export const DRAFT_REJECT_REASON_MAX = MAX_REASON;
