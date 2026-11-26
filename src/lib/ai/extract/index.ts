/**
 * Grounded structured extraction — a TypeScript take on Google's LangExtract.
 *
 * The model extracts typed spans copied verbatim from the source; each span is
 * then aligned back to the source (exact → normalized → fuzzy) and anything
 * that can't be found is dropped, so every claim the copilot or report uses
 * points at real evidence with character offsets.
 */
import type { AiTaskKind } from "../credentials";
import { callJson } from "../json-call";
import { alignSpan, chunkText, type AlignmentKind } from "./align";

export { alignSpan, chunkText, contentWords, wordOverlap } from "./align";

export interface ExtractionClass {
  name: string;
  description: string;
}

export interface ExtractionExample {
  text: string;
  extractions: { class: string; text: string; attributes?: Record<string, string> }[];
}

export interface GroundedExtraction {
  class: string;
  /** Exact source text at [start, end). */
  text: string;
  attributes: Record<string, string>;
  start: number;
  end: number;
  alignment: AlignmentKind;
  sourceId?: string;
}

export interface ExtractResult {
  items: GroundedExtraction[];
  /** Spans the model returned that could not be found in the source. */
  dropped: number;
  chunks: number;
  tokens: number;
}

function systemPrompt(classes: ExtractionClass[], instructions: string, examples: ExtractionExample[]): string {
  const ex = examples
    .map(
      (e, i) =>
        `Example ${i + 1}\nSOURCE:\n${e.text}\nOUTPUT:\n${JSON.stringify({ extractions: e.extractions.map((x) => ({ ...x, attributes: x.attributes ?? {} })) })}`,
    )
    .join("\n\n");
  return `You extract structured information from a source text.
${instructions}

Classes:
${classes.map((c) => `- ${c.name}: ${c.description}`).join("\n")}

Rules:
- "text" MUST be copied verbatim from the SOURCE (exact characters, no paraphrase, no ellipsis). Keep spans short: the smallest phrase or sentence that carries the fact.
- List extractions in the order they appear. Do not invent facts that aren't in the source.
- "attributes" are short string key/values that add meaning (e.g. {"years":"3","level":"lead"}). Use {} when none.
- Return JSON only: {"extractions":[{"class": string, "text": string, "attributes": object}]}

${ex}`.trim();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function extractGrounded(opts: {
  source: string;
  sourceId?: string;
  classes: ExtractionClass[];
  instructions: string;
  examples?: ExtractionExample[];
  organizationId?: string | null;
  task?: AiTaskKind;
  maxChunkChars?: number;
  maxPerChunk?: number;
  concurrency?: number;
  signal?: AbortSignal;
}): Promise<ExtractResult> {
  const source = opts.source ?? "";
  if (!source.trim()) return { items: [], dropped: 0, chunks: 0, tokens: 0 };
  const allowed = new Set(opts.classes.map((c) => c.name));
  const system = systemPrompt(opts.classes, opts.instructions, opts.examples ?? []);
  const chunks = chunkText(source, opts.maxChunkChars ?? 6_000);
  const maxPer = opts.maxPerChunk ?? 25;

  let tokens = 0;
  let dropped = 0;
  const perChunk = await mapLimit(chunks, opts.concurrency ?? 3, async (chunk) => {
    const { data, tokens: t } = await callJson<{ extractions?: unknown }>({
      organizationId: opts.organizationId,
      task: opts.task ?? "standard",
      system,
      messages: [{ role: "user", content: `SOURCE:\n${chunk.text}` }],
      maxTokens: 2500,
      temperature: 0.1,
      signal: opts.signal,
    });
    tokens += t;
    const raw = Array.isArray(data.extractions) ? data.extractions.slice(0, maxPer) : [];
    const found: GroundedExtraction[] = [];
    let cursor = 0;
    for (const r of raw) {
      const o = (r ?? {}) as Record<string, unknown>;
      const cls = typeof o.class === "string" ? o.class : "";
      const text = typeof o.text === "string" ? o.text : "";
      if (!allowed.has(cls) || !text.trim()) {
        dropped++;
        continue;
      }
      const a = alignSpan(chunk.text, text, { from: cursor });
      if (!a) {
        dropped++;
        continue;
      }
      cursor = a.end;
      const attributes: Record<string, string> = {};
      if (o.attributes && typeof o.attributes === "object") {
        for (const [k, v] of Object.entries(o.attributes as Record<string, unknown>).slice(0, 8)) {
          if (v !== null && v !== undefined && String(v).trim()) attributes[k.slice(0, 40)] = String(v).slice(0, 200);
        }
      }
      found.push({
        class: cls,
        text: chunk.text.slice(a.start, a.end),
        attributes,
        start: chunk.offset + a.start,
        end: chunk.offset + a.end,
        alignment: a.kind,
        sourceId: opts.sourceId,
      });
    }
    return found;
  });

  return { items: dedupeExtractions(perChunk.flat()), dropped, chunks: chunks.length, tokens };
}

/** Chunk overlap yields repeats: keep the first of any same-class spans that overlap. */
export function dedupeExtractions(items: GroundedExtraction[]): GroundedExtraction[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: GroundedExtraction[] = [];
  for (const it of sorted) {
    const clash = out.some((o) => o.class === it.class && o.sourceId === it.sourceId && it.start < o.end && o.start < it.end);
    if (!clash) out.push(it);
  }
  return out;
}

/** Compact prompt block for downstream steps: `[class] "quote" (attrs)`. */
export function extractionsPrompt(items: GroundedExtraction[], max = 40): string {
  return items
    .slice(0, max)
    .map((x) => {
      const attrs = Object.entries(x.attributes)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `- [${x.class}] "${x.text}"${attrs ? ` (${attrs})` : ""}`;
    })
    .join("\n");
}
