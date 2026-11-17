/**
 * Verification follow-ups appended to the interviewer system prompt when
 * anti-cheat integrity checks are on. Real-time copilots answer generic
 * questions well but degrade on personal specifics, callbacks to earlier
 * answers, and rephrasing. Applied the same way to every candidate.
 * Pure module — no path aliases, so the relay can import it.
 */
export function buildIntegrityProbingSection(enabled: boolean | null | undefined, isZh = false): string {
  if (!enabled) return "";
  if (isZh) {
    return [
      "",
      "## 真实性追问（对所有受访者一视同仁）",
      "- 在追问额度内，至少有一次追问要求受访者给出亲身经历的具体细节：哪个项目、他们本人做了什么、遇到的具体数字或困难。",
      "- 偶尔回顾受访者早先说过的内容，请他们把它和当前问题联系起来。",
      "- 如果回答听起来像教科书或过于工整，请他们用更简单的话或换一个角度再解释一次。",
      "- 不要指责、不要提及作弊或监控，语气保持友好自然。这些追问占用现有的追问次数，不额外增加。",
    ].join("\n");
  }
  return [
    "",
    "## Authenticity follow-ups (apply equally to every participant)",
    "- Within your follow-up budget, make at least one follow-up per question ask for first-hand specifics: which project, what they personally did, concrete numbers, what went wrong.",
    "- Occasionally refer back to something the participant said earlier and ask them to connect it to the current topic.",
    "- If an answer sounds textbook-perfect or generic, ask them to explain it again more simply or from a different angle.",
    "- Never accuse, and never mention cheating or monitoring; stay friendly and natural. These follow-ups use the existing follow-up budget, they do not add to it.",
  ].join("\n");
}
