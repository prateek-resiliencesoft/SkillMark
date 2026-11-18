/**
 * Resume instructions for a voice interview that reconnects (network drop,
 * relay reconnect or page reload). Pure, unit-tested. The relay puts
 * `resumeBehaviorRule` in place of the greeting rule of the system prompt and
 * sends `resumeCue` as the first message, so the interviewer continues where
 * it left off instead of starting over.
 */
import { stripToolCallText } from "@/lib/transcript/sanitize";

export type RecentLine = { role: "user" | "assistant"; text: string };

/** Sent by the browser on (re)connect when the interview already started. */
export type ResumeHints = {
  recent?: RecentLine[];
  askedQuestionIndexes?: number[];
};

export type ResumeState = {
  current: number;
  questions: Array<{ text: string }>;
  /** Indexes already asked and finished. */
  asked: number[];
  recent: RecentLine[];
  /** The candidate's last words have not been answered yet. */
  pendingAnswer?: boolean;
  /** Language to keep speaking after the resume (e.g. "Hindi (Hinglish)"). */
  language?: string;
};

/** " Keep speaking X." or "" — keeps the candidate's language across a reconnect. */
export function resumeLanguageNote(s: Pick<ResumeState, "language">): string {
  return s.language ? ` Keep speaking ${s.language}, the language the participant is using.` : "";
}

const MAX_LINES = 8;
const MAX_CHARS = 280;

/** Last few transcript lines, cleaned and shortened, for the prompt. */
export function recentRecap(recent: RecentLine[], isZh = false, maxLines = MAX_LINES): string {
  const lines = recent
    .map((l) => ({ role: l.role, text: stripToolCallText(l.text).replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text)
    .slice(-maxLines)
    .map((l) => {
      const who = l.role === "user" ? (isZh ? "受访者" : "Participant") : (isZh ? "你" : "You");
      const t = l.text.length > MAX_CHARS ? `${l.text.slice(0, MAX_CHARS)}…` : l.text;
      return `${who}: ${t}`;
    });
  return lines.join("\n");
}

/** Asked indexes: everything before the current question plus any hinted ones, never the current one. */
export function askedBefore(current: number, hinted: number[] = [], total = Number.MAX_SAFE_INTEGER): number[] {
  const set = new Set<number>();
  for (let i = 0; i < Math.min(current, total); i++) set.add(i);
  for (const i of hinted) if (Number.isInteger(i) && i >= 0 && i < total && i !== current) set.add(i);
  return [...set].sort((a, b) => a - b);
}

/** Whether a (re)connect should resume rather than start fresh. */
export function shouldResume(startIndex: number | undefined, hints: ResumeHints | null | undefined): boolean {
  return (startIndex ?? 0) > 0 || !!hints?.recent?.some((l) => l.text?.trim());
}

/** Replaces rule 1 ("greet and start at question 1") of the system prompt. */
export function resumeBehaviorRule(s: ResumeState, isZh = false): string {
  const total = s.questions.length;
  const n = s.current + 1;
  const asked = s.asked.filter((i) => i >= 0 && i < total && i !== s.current);
  const askedList = asked.map((i) => `   - ${i + 1}. ${s.questions[i]?.text ?? ""}`).join("\n");
  const recap = recentRecap(s.recent, isZh);
  if (isZh) {
    return `1. 【恢复面试】连接刚刚中断后恢复。这不是面试开始：不要打招呼，不要自我介绍，不要说一共有几个问题，也不要把任何问题称为"第一个问题"。当前是第${n}题（共${total}题）："${s.questions[s.current]?.text ?? ""}"。
${asked.length ? `   以下问题已经问过，绝对不要再问：\n${askedList}\n` : ""}${recap ? `   最近的对话：\n${recap.split("\n").map((l) => `   ${l}`).join("\n")}\n` : ""}   自然地继续：可以简短说一句"抱歉，刚才连接断了。"如果受访者还没回答第${n}题，就再问一次这道题；如果他们正在回答，请他们继续。`;
  }
  return `1. RESUMING after a dropped connection. This is NOT the start of the interview: do NOT greet, do NOT introduce yourself, do NOT say how many questions there are, and NEVER call any question "the first question". We are on question ${n} of ${total}: "${s.questions[s.current]?.text ?? ""}".
${asked.length ? `   Questions already asked — never ask these again:\n${askedList}\n` : ""}${recap ? `   Recent conversation:\n${recap.split("\n").map((l) => `   ${l}`).join("\n")}\n` : ""}   Continue naturally: you may say one short line like "Sorry, we got disconnected." If the participant had not answered question ${n} yet, ask it again; if they were in the middle of answering, ask them to go on.${resumeLanguageNote(s)}`;
}

/** First message after the resumed session is set up. */
export function resumeCue(s: ResumeState, isZh = false): string {
  const total = s.questions.length;
  const n = s.current + 1;
  const q = s.questions[s.current]?.text ?? "";
  if (isZh) {
    return s.pendingAnswer
      ? `[SYSTEM] 连接已恢复（不要打招呼或自我介绍）。当前第${n}题（共${total}题）："${q}"。受访者上一次的回答还没有得到回应——现在直接回应。`
      : `[SYSTEM] 连接已恢复（不要打招呼或自我介绍）。当前第${n}题（共${total}题）："${q}"。从中断处继续：简短说明刚才断线了，然后继续这道题。不要重复已经问过的问题。`;
  }
  return s.pendingAnswer
    ? `[SYSTEM] Connection restored (no greeting, no introduction). We are on question ${n} of ${total}: "${q}". The participant's last answer has not been replied to yet — respond to it now out loud.${resumeLanguageNote(s)}`
    : `[SYSTEM] Connection restored (no greeting, no introduction). We are on question ${n} of ${total}: "${q}". Continue from where it left off: briefly say the connection dropped, then continue this question. Do not repeat questions already asked.${resumeLanguageNote(s)}`;
}

/** Browser side: hints for the relay's init message (null on a fresh start). */
export function buildResumeHints(current: number, recent: RecentLine[], asked: number[]): ResumeHints | null {
  const lines = recent
    .map((l) => ({ role: l.role, text: stripToolCallText(l.text) }))
    .filter((l) => l.text)
    .slice(-MAX_LINES);
  if (current <= 0 && lines.length === 0) return null;
  return { recent: lines, askedQuestionIndexes: [...new Set(asked)].filter((i) => Number.isInteger(i) && i >= 0 && i !== current).sort((a, b) => a - b) };
}
