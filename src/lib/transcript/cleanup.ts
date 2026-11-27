/**
 * Light text clean-up of a rebuilt candidate transcript.
 *
 * Speech models still mishear names and skills ("Fit Pasio" for FitPassio). One
 * short pass with any text model the org has (Gemini / OpenAI / Anthropic ...)
 * fixes only those clear mishearings. It must never translate, summarise or
 * invent, so every result is checked and the original wins when it drifts:
 *  - per turn: word count within ±15% (min ±2 words), same numbers, not empty
 *  - whole transcript: total word count within ±15% (a few words of slack for very short transcripts)
 * Pure apart from the injected model call.
 */

export type CleanupTurn = { text: string; /** The interviewer line it answers (context only). */ question?: string };

export type CleanupContext = {
  hindi: boolean;
  candidateName?: string | null;
  companyName?: string | null;
  interviewTitle?: string | null;
  vocabulary: string[];
};

export const MAX_WORD_DRIFT = 0.15;

export const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

function numberTokens(t: string): string[] {
  return (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")).sort();
}

/** True when `cleaned` is an acceptable edit of `original`. */
export function isSafeEdit(original: string, cleaned: string): boolean {
  const c = cleaned.trim();
  if (!c) return false;
  const o = countWords(original);
  const n = countWords(c);
  const allowed = Math.max(2, Math.floor(o * MAX_WORD_DRIFT));
  if (Math.abs(n - o) > allowed) return false;
  const a = numberTokens(original);
  const b = numberTokens(c);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return false;
  // Never bring Devanagari back into a Roman-script transcript.
  if (/[\u0900-\u097F]/.test(c) && !/[\u0900-\u097F]/.test(original)) return false;
  return true;
}

export type GuardResult = { texts: string[]; changed: number; rejected: number; wholeRejected: boolean };

/** Apply model output to the originals, keeping the original wherever the edit is unsafe. */
export function applyCleanupGuard(originals: string[], cleaned: (string | null | undefined)[]): GuardResult {
  let rejected = 0;
  const texts = originals.map((o, i) => {
    const c = cleaned[i];
    if (typeof c !== "string" || c.trim() === o.trim()) return o;
    const clean = c.replace(/\s+/g, " ").trim();
    if (isSafeEdit(o, clean)) return clean;
    rejected++;
    return o;
  });
  const before = originals.reduce((n, t) => n + countWords(t), 0);
  const after = texts.reduce((n, t) => n + countWords(t), 0);
  if (before > 0 && Math.abs(after - before) > 3 && Math.abs(after - before) / before > MAX_WORD_DRIFT) {
    return { texts: originals, changed: 0, rejected: originals.length, wholeRejected: true };
  }
  const changed = texts.reduce((n, t, i) => n + (t !== originals[i] ? 1 : 0), 0);
  return { texts, changed, rejected, wholeRejected: false };
}

export function buildCleanupPrompt(ctx: CleanupContext): string {
  const terms = ctx.vocabulary.slice(0, 80).join(", ");
  return `You proofread a speech-to-text transcript of a job interview candidate's answers.
Fix ONLY clear mishearings of proper nouns and technical terms, using the known terms below. Leave everything else exactly as it is.

Hard rules:
- Never translate, summarise, shorten, expand, reorder or add content. Never answer or complete a sentence.
- Keep the same words in the same order. A fixed term replaces the misheard word(s); nothing else changes.
- ${ctx.hindi ? "The text is Roman-script Hinglish (Hindi written in English letters mixed with English). Keep it Roman-script Hinglish; never convert to Devanagari or to pure English. English words that were spelled out letter by letter the Hindi way are mishearings too: write them in normal English spelling (eksapiriyans → experience, devalapar → developer, karentli → currently, phlatar → Flutter, sophtaveyar → software, eplikeshan → application, mainej → manage). Hindi words stay as they are." : "Keep the language as written."}
- Keep every number and amount exactly as written (8.65 LPA stays 8.65 LPA). Never change digits.
- If unsure, leave the text unchanged.
- Each turn also shows the interviewer's question. It is context only; never edit or return it.

Known names and terms: ${terms || "(none)"}
${ctx.candidateName ? `Candidate name: ${ctx.candidateName}\n` : ""}${ctx.companyName ? `Company: ${ctx.companyName}\n` : ""}${ctx.interviewTitle ? `Role: ${ctx.interviewTitle}\n` : ""}
Return JSON only: {"turns":[{"id":number,"text":string}]} with one entry per input turn, same ids.`;
}

export type CleanupModelCall = (system: string, user: string) => Promise<string>;

const BATCH_TURNS = 30;

export type CleanupOutcome = GuardResult & { ran: boolean; error?: string };

/**
 * Run the clean-up pass. Never throws: on any failure the original texts come back.
 */
export async function cleanupTranscript(
  turns: CleanupTurn[],
  ctx: CleanupContext,
  call: CleanupModelCall,
  extract: (raw: string) => { turns?: { id?: number; text?: string }[] },
): Promise<CleanupOutcome> {
  const originals = turns.map((t) => t.text);
  if (!originals.length || !originals.some((t) => t.trim())) {
    return { texts: originals, changed: 0, rejected: 0, wholeRejected: false, ran: false };
  }
  const system = buildCleanupPrompt(ctx);
  const cleaned: (string | undefined)[] = new Array(turns.length).fill(undefined);
  try {
    for (let from = 0; from < turns.length; from += BATCH_TURNS) {
      const batch = turns.slice(from, from + BATCH_TURNS);
      const user = JSON.stringify({
        turns: batch.map((t, i) => ({
          id: from + i,
          question: t.question ? t.question.replace(/\s+/g, " ").slice(0, 300) : undefined,
          text: t.text,
        })),
      });
      const parsed = extract(await call(system, user));
      for (const row of parsed.turns ?? []) {
        const id = Number(row.id);
        if (Number.isInteger(id) && id >= from && id < from + batch.length && typeof row.text === "string") {
          cleaned[id] = row.text;
        }
      }
    }
  } catch (err) {
    return {
      texts: originals,
      changed: 0,
      rejected: 0,
      wholeRejected: false,
      ran: false,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
  return { ...applyCleanupGuard(originals, cleaned), ran: true };
}
