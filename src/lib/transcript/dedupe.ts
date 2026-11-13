/**
 * Helpers that keep live voice transcripts clean:
 *  - join streaming transcription chunks without gluing words ("isYes")
 *  - spot a candidate line that repeats the previous one (re-sent buffer or
 *    the candidate saying the same answer again because the AI went quiet)
 * Pure (no I/O) so they can be unit-tested and shared by browser, relay and API.
 */

/** Append a streaming transcription chunk, adding a space where words would otherwise be glued. */
export function joinTranscriptChunk(buf: string, chunk: string): string {
  if (!chunk) return buf;
  if (!buf) return chunk;
  const last = buf[buf.length - 1];
  const first = chunk[0];
  if (/\s/.test(last) || /\s/.test(first)) return buf + chunk;
  // "is" + "Yes" → "is Yes"; "LPA." + "My" → "LPA. My"; "norms," + "and" → "norms, and"
  const prevEndsWord = /[\p{L}\p{N}]/u.test(last);
  const prevEndsPunct = /[.,!?;:…]/.test(last);
  const nextStartsUpper = /\p{Lu}/u.test(first);
  const nextStartsWord = /[\p{L}\p{N}]/u.test(first);
  if ((prevEndsWord && nextStartsUpper) || (prevEndsPunct && nextStartsWord)) return `${buf} ${chunk}`;
  return buf + chunk;
}

/** Lowercase, drop punctuation, collapse spaces. */
export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type RepeatKind = "same" | "contained" | "extends" | "similar" | null;

/** Min words before fuzzy "similar" matching is trusted (short replies like "yes" repeat legitimately). */
const SIMILAR_MIN_WORDS = 6;
const SIMILAR_RATIO = 0.85;

/**
 * Compare a new candidate line with the previous one.
 *  same      – identical after normalisation
 *  contained – new line is already inside the previous one (re-sent fragment)
 *  extends   – new line starts with the previous one and adds more (buffer grew)
 *  similar   – ≥85% of the shorter line's words appear in the other (same answer said again)
 */
export function compareUserLines(prev: string | null | undefined, next: string): RepeatKind {
  if (!prev) return null;
  const a = normalizeForCompare(prev);
  const b = normalizeForCompare(next);
  if (!a || !b) return null;
  if (a === b) return "same";
  if (b.length >= 12 && a.includes(b)) return "contained";
  if (a.length >= 12 && b.startsWith(a)) return "extends";
  const wa = a.split(" ");
  const wb = b.split(" ");
  const shorter = wa.length <= wb.length ? wa : wb;
  const longer = wa.length <= wb.length ? wb : wa;
  if (shorter.length < SIMILAR_MIN_WORDS) return null;
  const pool = new Map<string, number>();
  for (const w of longer) pool.set(w, (pool.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of shorter) {
    const n = pool.get(w) ?? 0;
    if (n > 0) {
      common += 1;
      pool.set(w, n - 1);
    }
  }
  return common / shorter.length >= SIMILAR_RATIO ? "similar" : null;
}

export type SaveLine = { role: string; content: string };

/**
 * Server-side guard for /api/voice/save: drop candidate lines that repeat the
 * candidate line right before them (with no interviewer line in between).
 * `lastSaved` is the newest row already in the DB for this session.
 * Exact / contained repeats are dropped, and "similar" repeats unless the new
 * line is clearly longer; a line that extends the previous one is kept
 * (it carries new words).
 */
export function dropRepeatedUserLines<T extends SaveLine>(
  lastSaved: SaveLine | null | undefined,
  messages: T[],
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let prev: SaveLine | null = lastSaved ?? null;
  let dropped = 0;
  for (const m of messages) {
    const isUser = m.role === "user" || m.role === "USER";
    const prevIsUser = !!prev && (prev.role === "user" || prev.role === "USER");
    if (isUser && prevIsUser) {
      const kind = compareUserLines(prev!.content, m.content);
      const prevWords = normalizeForCompare(prev!.content).split(" ").length;
      const nextWords = normalizeForCompare(m.content).split(" ").length;
      const similarNotLonger = kind === "similar" && nextWords <= prevWords * 1.25;
      if (kind === "same" || kind === "contained" || similarNotLonger) {
        dropped += 1;
        continue;
      }
    }
    kept.push(m);
    prev = m;
  }
  return { kept, dropped };
}
