/**
 * Per-candidate tailoring block appended to the interviewer system prompt
 * (voice relay + chat). Pure module — no path aliases, so the relay can import it.
 */
export interface CandidateFocus {
  skills?: string[] | null;
  questions?: Array<{ text: string; skill?: string | null }> | null;
}

export function hasCandidateFocus(f: CandidateFocus | null | undefined): f is CandidateFocus {
  return !!f && ((f.questions?.length ?? 0) > 0 || (f.skills?.length ?? 0) > 0);
}

export function buildCandidateFocusSection(f: CandidateFocus | null | undefined, totalQuestions: number): string {
  if (!hasCandidateFocus(f)) return "";
  const skills = (f.skills ?? []).filter(Boolean).slice(0, 15);
  const qs = (f.questions ?? []).filter((q) => q?.text).slice(0, 6);
  const lines: string[] = ["", "## Candidate-specific focus (from their resume)"];
  if (skills.length) lines.push(`- Skills listed on the resume: ${skills.join(", ")}`);
  if (qs.length) {
    lines.push(
      `- Tailored questions — cover these during the interview (about ${qs.length} of the ${totalQuestions} script questions' time). Ask each one as a follow-up after the most related script question; if none is related, ask them right before the final wrap-up:`,
    );
    qs.forEach((q, i) => lines.push(`  T${i + 1}. ${q.text}${q.skill ? ` (skill: ${q.skill})` : ""}`));
    lines.push(
      "- Still ask every script question and keep their order and numbering. To keep total length similar, use fewer generic follow-ups on the script questions.",
      "- Tailored questions are NOT script questions: do NOT call signal_question_change for them and do not count them in question numbers.",
    );
  } else {
    lines.push("- When asking follow-ups, prefer examples that use these skills.");
  }
  return lines.join("\n");
}
