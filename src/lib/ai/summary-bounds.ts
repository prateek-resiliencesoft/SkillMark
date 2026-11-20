/**
 * Caps on what a session report sends to the LLM (and rasterizes), so candidate-controlled
 * message/drawing/snippet volume cannot amplify prompt size, memory or sharp work.
 */
export const SUMMARY_MAX_MESSAGES_LOADED = 5000;
export const SUMMARY_MAX_TRANSCRIPT_CHARS = 120_000;
export const SUMMARY_MAX_MESSAGE_CHARS = 4000;
export const SUMMARY_MAX_CODE_SNIPPETS = 20;
export const SUMMARY_MAX_SNIPPET_CHARS = 20_000;
export const SUMMARY_MAX_CODE_CHARS = 60_000;
export const SUMMARY_MAX_DRAWINGS = 10;
/** Whiteboard data URLs above this are not rasterized or sent. */
export const SUMMARY_MAX_DRAWING_DATA_URL_CHARS = 2 * 1024 * 1024;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)} […truncated]` : text;
}

/**
 * Keeps the start and end of an over-long transcript (opening context and final answers)
 * and replaces the middle with one marker line.
 */
export function boundTranscript<T extends { role: string; content: string }>(messages: T[]): T[] {
  const clipped = messages.map((m) => ({ ...m, content: clip(String(m.content ?? ""), SUMMARY_MAX_MESSAGE_CHARS) }));
  const total = clipped.reduce((n, m) => n + m.content.length, 0);
  if (total <= SUMMARY_MAX_TRANSCRIPT_CHARS) return clipped;

  const half = SUMMARY_MAX_TRANSCRIPT_CHARS / 2;
  const head: T[] = [];
  let used = 0;
  for (const m of clipped) {
    if (used + m.content.length > half) break;
    head.push(m);
    used += m.content.length;
  }
  const tail: T[] = [];
  used = 0;
  for (let i = clipped.length - 1; i >= head.length; i--) {
    const m = clipped[i];
    if (used + m.content.length > half) break;
    tail.unshift(m);
    used += m.content.length;
  }
  const omitted = clipped.length - head.length - tail.length;
  const marker = { role: "assistant", content: `[${omitted} messages omitted from the middle of a very long transcript]` } as T;
  return [...head, marker, ...tail];
}

export function boundCodeSnippets<T extends { code: string }>(snippets: T[]): T[] {
  const out: T[] = [];
  let used = 0;
  for (const s of snippets.slice(-SUMMARY_MAX_CODE_SNIPPETS).reverse()) {
    const code = clip(s.code, SUMMARY_MAX_SNIPPET_CHARS);
    if (used + code.length > SUMMARY_MAX_CODE_CHARS) break;
    out.unshift({ ...s, code });
    used += code.length;
  }
  return out;
}

/** Latest drawings only; oversized data URLs are dropped before any decoding. */
export function boundDrawings<T extends { imageDataUrl: string | null }>(drawings: T[]): T[] {
  return drawings.slice(-SUMMARY_MAX_DRAWINGS).map((d) => ({
    ...d,
    imageDataUrl:
      typeof d.imageDataUrl === "string" && d.imageDataUrl.length <= SUMMARY_MAX_DRAWING_DATA_URL_CHARS
        ? d.imageDataUrl
        : null,
  }));
}
