/**
 * Place transcribed candidate turns between the saved interviewer messages.
 * Pure (no I/O) so it can be unit-tested.
 *
 * Rules that keep the interviewer and the candidate apart:
 * - Only turns the model labelled "candidate" can become USER lines.
 * - The saved ASSISTANT lines are the source of truth for the interviewer.
 *   They are never rewritten, and any candidate text that repeats them
 *   (the AI voice is on the recording, or leaks through the candidate's
 *   speakers) is dropped as an echo.
 * - Each candidate turn goes under the question asked just before it:
 *   by recording time first, then the model's afterLine, then spoken order.
 */
export type TranscribedTurn = {
  speaker?: string;
  startSec?: number;
  endSec?: number;
  afterLine?: number;
  text?: string;
};

export type AnchorMessage = { timestamp: string; questionId: string | null };

export type AlignedTurn = { text: string; timestamp: string; questionId: string | null };

const FALLBACK_GAP_MS = 60_000;

// ── Echo filtering ──────────────────────────────────────────────────────────

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function bigrams(t: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(`${t[i]} ${t[i + 1]}`);
  return out;
}

export type EchoIndex = { tokenSets: Set<string>[]; bigramSets: Set<string>[]; joined: string[] };

export function buildEchoIndex(interviewerLines: string[]): EchoIndex {
  const toks = interviewerLines.map(tokens).filter((t) => t.length > 0);
  return {
    tokenSets: toks.map((t) => new Set(t)),
    bigramSets: toks.map((t) => new Set(bigrams(t))),
    joined: toks.map((t) => ` ${t.join(" ")} `),
  };
}

/** Share of the fragment's words found in one interviewer line (word pairs as a guard); best line wins. */
export function echoScore(fragment: string, index: EchoIndex): number {
  const t = tokens(fragment);
  if (t.length === 0) return 0;
  const bg = bigrams(t);
  let best = 0;
  for (let i = 0; i < index.tokenSets.length; i++) {
    const tokShare = t.filter((w) => index.tokenSets[i].has(w)).length / t.length;
    const bgShare = bg.length ? bg.filter((b) => index.bigramSets[i].has(b)).length / bg.length : tokShare;
    // Word share decides; word pairs only guard against a loose bag of shared words
    // (so a slightly misheard echo, e.g. "front end" for "frontend", still matches).
    best = Math.max(best, bgShare >= 0.4 ? tokShare : Math.min(tokShare, bgShare));
  }
  return best;
}

/**
 * True when a fragment is just the interviewer's words repeated.
 * Short fragments (2–3 words) only count when they appear verbatim and make up
 * most of an interviewer line (e.g. "Are you there?"), so real short answers
 * like "yes", "I can hear you" or "I think so" are kept.
 */
export function isInterviewerEcho(fragment: string, index: EchoIndex, threshold = 0.75): boolean {
  const t = tokens(fragment);
  if (t.length < 2) return false;
  if (t.length < 4) {
    const needle = ` ${t.join(" ")} `;
    return index.joined.some((j) => j.includes(needle) && t.length / j.trim().split(" ").length >= 0.6);
  }
  return echoScore(fragment, index) >= threshold;
}

/** Remove echoed interviewer sentences from a candidate turn; "" when nothing of the candidate's own is left. */
export function stripInterviewerEcho(text: string, index: EchoIndex): string {
  if (!index.tokenSets.length) return text;
  if (isInterviewerEcho(text, index)) return "";
  const sentences = text.match(/[^.!?。？！]+[.!?。？！]*/g) ?? [text];
  if (sentences.length < 2) return text;
  return sentences
    .filter((s) => !isInterviewerEcho(s, index))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Alignment ───────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (v == null || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

const isSpeaker = (t: TranscribedTurn, who: string) => String(t.speaker ?? "").trim().toLowerCase() === who;

export function alignCandidateTurns(
  turns: TranscribedTurn[],
  anchors: AnchorMessage[],
  interviewerLines: string[] = [],
): AlignedTurn[] {
  const n = anchors.length;
  const echo = buildEchoIndex(interviewerLines);

  // Interviewer turns the model matched to a saved line give a recording-time → line map.
  const timeline = turns
    .filter((t) => isSpeaker(t, "interviewer"))
    .map((t) => ({ at: num(t.startSec), line: Math.trunc(num(t.afterLine)) }))
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.line) && p.line >= 1 && p.line <= n)
    .sort((a, b) => a.at - b.at);
  /** Latest saved line spoken at or before `sec` (NaN when the timeline can't say). */
  const lineAtTime = (sec: number): number => {
    if (!timeline.length) return NaN;
    let line = 0;
    for (const p of timeline) {
      if (p.at > sec) break;
      line = Math.max(line, p.line);
    }
    return line;
  };

  const candidate = turns
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isSpeaker(t, "candidate"))
    .sort((a, b) => {
      // Spoken order: by startSec when both have it, otherwise the model's order.
      const sa = num(a.t.startSec);
      const sb = num(b.t.startSec);
      return Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb ? sa - sb : a.i - b.i;
    })
    .map(({ t }) => {
      const raw = String(t.text ?? "").replace(/\s+/g, " ").trim();
      const start = num(t.startSec);
      return {
        text: stripInterviewerEcho(raw, echo),
        byTime: Number.isFinite(start) ? lineAtTime(start) : NaN,
        afterLine: Math.trunc(num(t.afterLine)),
      };
    })
    .filter((t) => t.text && !/^\[?inaudible\]?\.?$/i.test(t.text));

  // Pick the anchor (0..N) and keep anchors non-decreasing (turns are in spoken order).
  let prev = 0;
  const withAnchor = candidate.map((t) => {
    const pick = Number.isFinite(t.byTime) ? t.byTime : Number.isFinite(t.afterLine) ? t.afterLine : prev;
    let a = Math.min(Math.max(pick, 0), n);
    if (a < prev) a = prev;
    prev = a;
    return { text: t.text, anchor: a };
  });

  // Group by anchor so several turns after one question spread evenly in its gap.
  const groups = new Map<number, typeof withAnchor>();
  for (const t of withAnchor) {
    const g = groups.get(t.anchor) ?? [];
    g.push(t);
    groups.set(t.anchor, g);
  }

  const ts = anchors.map((a) => new Date(a.timestamp).getTime());
  const out: AlignedTurn[] = [];
  for (const [anchor, group] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
    // anchor k (1-based) sits after anchors[k-1] and before anchors[k].
    const lo = anchor > 0 ? ts[anchor - 1] : (ts[0] ?? Date.now()) - FALLBACK_GAP_MS;
    const hi = anchor < n ? ts[anchor] : lo + FALLBACK_GAP_MS;
    const span = Math.max(hi - lo, group.length + 1);
    const questionId = anchor > 0 ? anchors[anchor - 1].questionId : (anchors[0]?.questionId ?? null);
    group.forEach((t, i) => {
      out.push({
        text: t.text,
        timestamp: new Date(lo + Math.max(1, Math.floor((span * (i + 1)) / (group.length + 1)))).toISOString(),
        questionId,
      });
    });
  }
  return out;
}

// ── Replacement plan (idempotent) ───────────────────────────────────────────

export type StoredMessage = {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  questionId: string | null;
  transcription: string | null;
};

export type ReplacementPlan = {
  /** USER rows to remove: earlier re-transcribed rows and live voice rows. Never ASSISTANT, never typed answers. */
  deleteIds: string[];
  replaced: StoredMessage[];
  /** New rows; role is always USER. */
  insert: (AlignedTurn & { role: "USER"; transcription: "recording" })[];
};

/**
 * Work out what to delete and insert. Running it again after applying it gives
 * the same rows: earlier "recording" rows are always replaced, never stacked.
 */
export function planTranscriptReplacement(messages: StoredMessage[], turns: TranscribedTurn[]): ReplacementPlan {
  const sorted = [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const assistant = sorted.filter((m) => m.role.toUpperCase() === "ASSISTANT");
  const replaced = sorted.filter(
    (m) => m.role.toUpperCase() === "USER" && (m.transcription == null || m.transcription === "recording"),
  );
  const aligned = alignCandidateTurns(
    turns,
    assistant.map((m) => ({ timestamp: m.timestamp, questionId: m.questionId })),
    assistant.map((m) => m.content),
  );
  return {
    deleteIds: replaced.map((m) => m.id),
    replaced,
    insert: aligned.map((t) => ({ ...t, role: "USER" as const, transcription: "recording" as const })),
  };
}
