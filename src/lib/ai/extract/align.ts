/**
 * Source grounding for LLM extractions (the LangExtract idea, in TypeScript):
 * every extracted span must be found in the source text, and carries its
 * character offsets so the UI can show and highlight the exact evidence.
 * Pure functions — no I/O.
 */

export type AlignmentKind = "exact" | "normalized" | "fuzzy";

export interface Alignment {
  start: number;
  end: number;
  kind: AlignmentKind;
}

const QUOTES: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"', "\u2013": "-", "\u2014": "-" };

/** Lower-cased, whitespace-collapsed copy of `text` with a map back to original offsets. */
function normalize(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    let ch = QUOTES[text[i]] ?? text[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      ch = " ";
      prevSpace = true;
    } else {
      prevSpace = false;
      ch = ch.toLowerCase();
    }
    norm += ch;
    map.push(i);
  }
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+(?:['.][\p{L}\p{N}]+)*/gu)) {
    out.push({ word: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/** Fraction of the needle's words found (as a multiset) in a same-size source window. */
function windowScore(needle: string[], window: Token[]): number {
  const bag = new Map<string, number>();
  for (const t of window) bag.set(t.word, (bag.get(t.word) ?? 0) + 1);
  let hit = 0;
  for (const w of needle) {
    const n = bag.get(w) ?? 0;
    if (n > 0) {
      hit++;
      bag.set(w, n - 1);
    }
  }
  return hit / needle.length;
}

/**
 * Locate `needle` in `source`: exact, then case/whitespace-insensitive, then a
 * fuzzy word window (≥ `minFuzzy` of the words, in a window of the same length).
 * `from` prefers matches at or after that offset (extractions arrive in order).
 */
export function alignSpan(source: string, needle: string, opts: { from?: number; minFuzzy?: number } = {}): Alignment | null {
  const want = needle.trim();
  if (!want || !source) return null;
  const from = Math.max(0, opts.from ?? 0);

  let at = source.indexOf(want, from);
  if (at < 0) at = source.indexOf(want);
  if (at >= 0) return { start: at, end: at + want.length, kind: "exact" };

  const s = normalize(source);
  const n = normalize(want).norm;
  if (n) {
    const fromNorm = s.map.findIndex((o) => o >= from);
    let k = s.norm.indexOf(n, Math.max(0, fromNorm));
    if (k < 0) k = s.norm.indexOf(n);
    if (k >= 0) return { start: s.map[k], end: s.map[k + n.length - 1] + 1, kind: "normalized" };
  }

  const needleWords = tokens(want).map((t) => t.word);
  if (needleWords.length < 3) return null;
  const src = tokens(source);
  const size = needleWords.length;
  if (src.length < size) return null;
  const minFuzzy = opts.minFuzzy ?? 0.75;
  let best: { score: number; i: number } | null = null;
  for (let i = 0; i + size <= src.length; i++) {
    const score = windowScore(needleWords, src.slice(i, i + size));
    if (score >= minFuzzy && (!best || score > best.score || (score === best.score && src[i].start >= from && src[best.i].start < from))) {
      best = { score, i };
      if (score === 1) break;
    }
  }
  if (!best) return null;
  return { start: src[best.i].start, end: src[best.i + size - 1].end, kind: "fuzzy" };
}

export interface TextChunk {
  text: string;
  offset: number;
}

/** Split on paragraph / sentence boundaries into chunks of ≤ maxChars, overlapping by `overlap`. */
export function chunkText(text: string, maxChars = 6_000, overlap = 300): TextChunk[] {
  if (text.length <= maxChars) return [{ text, offset: 0 }];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (cut > maxChars * 0.5) end = start + cut + 1;
    }
    chunks.push({ text: text.slice(start, end), offset: start });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

const STOP_WORDS = new Set(
  "a an and are as at be but by did do for from had has have i in is it its me my of on or our so that the their them then there they this to was we were what when which who will with you your".split(" "),
);

/** Content words of a text (lower-cased, stop words removed). */
export function contentWords(text: string): Set<string> {
  return new Set(tokens(text).map((t) => t.word).filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
}

/** Jaccard overlap of content words — cheap relatedness for pairing claims. */
export function wordOverlap(a: string, b: string): number {
  const x = contentWords(a);
  const y = contentWords(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}
