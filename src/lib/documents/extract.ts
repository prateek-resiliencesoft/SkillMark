/**
 * Document → Markdown extraction (server-only).
 *
 *   PDF:  pdf-parse (text layer) → vision AI if scanned/thin
 *   DOCX: mammoth
 *   Image: vision AI
 */
import { configuredGeminiModel } from "@/lib/ai/gemini-models";
import { unwrappingFetch } from "@/lib/ai/providers/compatible";
import "server-only";
import OpenAI from "openai";
import sharp from "sharp";
import { loadOrgAiCredentials } from "@/lib/ai/credentials";
import { assertZipWithinLimits, htmlToMarkdown, normalise } from "@/lib/documents/docx-safety";
import { budgetSignal, isAbortError, VISION_CALL_TIMEOUT_MS } from "@/lib/ai/fail-fast";
import { classifyAiFailure, isAuthError, isQuotaError, keyChainExhaustedError } from "@/lib/ai/key-chain";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";

const log = createLogger("documents/extract");

// Import the library entry directly: the package index runs a debug self-test
// when it has no parent module (tsx, workers).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer,
  options?: { pagerender?: (page: PdfPage) => Promise<string>; max?: number },
) => Promise<{ text: string; numpages: number }>;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth") as {
  convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string; messages: { message: string }[] }>;
};

interface PdfTextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}
interface PdfPage {
  getTextContent: (opts?: Record<string, boolean>) => Promise<{ items: PdfTextItem[] }>;
}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 50;

/** Below this many characters a PDF page is treated as scanned (no text layer). */
const MIN_CHARS_PER_PAGE = 80;
const MAX_VISION_IMAGE_PX = 2000;

export type ExtractionMethod = "docx" | "pdf-text" | "vision" | "plain-text";

export interface ExtractedDocument {
  markdown: string;
  method: ExtractionMethod;
  pages: number;
  warnings: string[];
}

type DocKind = "pdf" | "docx" | "image" | "text";

export function detectKind(fileName: string, mime: string, buffer: Buffer): DocKind | null {
  const name = fileName.toLowerCase();
  // Magic bytes win over (spoofable) extension / mime.
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && name.endsWith(".docx")) return "docx";
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|tiff?|bmp|heic)$/.test(name)) return "image";
  if (mime.startsWith("text/") || /\.(txt|md)$/.test(name)) return "text";
  return null;
}

export async function extractDocument(
  buffer: Buffer,
  fileName: string,
  mime: string,
  options?: { organizationId?: string | null; signal?: AbortSignal },
): Promise<ExtractedDocument> {
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`File is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
  }
  const kind = detectKind(fileName, mime, buffer);
  if (!kind) throw new Error("Unsupported file type. Use PDF, DOCX, TXT or an image.");

  if (kind === "text") {
    return { markdown: normalise(buffer.toString("utf8")), method: "plain-text", pages: 1, warnings: [] };
  }

  options?.signal?.throwIfAborted();

  if (kind === "docx") {
    return extractDocx(buffer);
  }

  if (kind === "pdf") {
    return extractPdf(buffer, fileName, options?.organizationId, options?.signal);
  }

  return extractImage(buffer, options?.organizationId, options?.signal);
}

/** Vision LLM only when pdf-parse finds little text (scanned PDF). */
const CV_VISION_BUDGET_MS = 20_000;
/** Enough markdown from pdf-parse to skip AI vision. */
const MIN_CHARS_GOOD_EXTRACT = 120;

/* ------------------------------------------------------------------ */
/*  DOCX                                                               */
/* ------------------------------------------------------------------ */

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  assertZipWithinLimits(buffer);
  const { value: html, messages } = await mammoth.convertToHtml({ buffer });
  const markdown = htmlToMarkdown(html);
  const warnings = messages
    .map((m) => m.message)
    .filter((m) => !/unrecognised|unrecognized/i.test(m))
    .slice(0, 5);
  if (markdown.length < MIN_CHARS_PER_PAGE) {
    warnings.push("DOCX contains little or no text (content may be embedded as images).");
  }
  return { markdown, method: "docx", pages: 1, warnings };
}

/* ------------------------------------------------------------------ */
/*  PDF                                                                */
/* ------------------------------------------------------------------ */

/**
 * Rebuilds each page's lines from text-item coordinates so table rows and
 * side-by-side columns don't get interleaved into one stream.
 */
async function renderPdfPage(page: PdfPage): Promise<string> {
  const { items } = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  const lines = new Map<number, { x: number; str: string }[]>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5] / 3) * 3; // bucket ~3pt baselines
    const x = item.transform[4];
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y)!.push({ x, str: item.str });
  }
  const text = Array.from(lines.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => {
      parts.sort((a, b) => a.x - b.x);
      // Wide horizontal gaps become column separators.
      let line = "";
      let lastX = -Infinity;
      for (const p of parts) {
        if (line && p.x - lastX > 40) line += "  |  ";
        else if (line && !line.endsWith(" ")) line += " ";
        line += p.str;
        lastX = p.x + p.str.length * 4;
      }
      return line;
    })
    .join("\n");
  return `${text}\n\f`;
}

async function extractPdf(
  buffer: Buffer,
  fileName: string,
  organizationId?: string | null,
  signal?: AbortSignal,
): Promise<ExtractedDocument> {
  const warnings: string[] = [];
  signal?.throwIfAborted();

  let pages: string[] = [];
  let numPages = 0;
  try {
    const parsed = await pdfParse(buffer, { pagerender: renderPdfPage, max: MAX_PDF_PAGES });
    numPages = parsed.numpages;
    pages = parsed.text
      .split("\f")
      .map((p) => p.trim())
      .filter((_, i) => i < Math.min(numPages, MAX_PDF_PAGES));
    if (numPages > MAX_PDF_PAGES) warnings.push(`Only the first ${MAX_PDF_PAGES} of ${numPages} pages were read.`);
  } catch (err) {
    log.warn("pdf-parse failed:", err);
    warnings.push("PDF text layer could not be read.");
  }

  const scannedPages = pages.filter((p) => p.length < MIN_CHARS_PER_PAGE).length;
  const textChars = pages.reduce((n, p) => n + p.length, 0);
  const textMarkdown = () =>
    normalise(
      pages.length
        ? pages.map((p, i) => `<!-- page ${i + 1} -->\n${p}`).join("\n\n")
        : "",
    );

  if (textChars >= MIN_CHARS_GOOD_EXTRACT) {
    if (scannedPages > 0) {
      warnings.push(`${scannedPages} page(s) look scanned; used available text layer.`);
    }
    log.info(`PDF extract via pdf-parse: ${fileName} chars=${textChars}`);
    return { markdown: textMarkdown(), method: "pdf-text", pages: numPages, warnings };
  }

  // Vision only for scanned / empty text-layer PDFs.
  signal?.throwIfAborted();
  const visions = await getVisionClients(organizationId);
  if (!visions.length) {
    warnings.push(
      "PDF has little text and no vision model is configured — review manually.",
    );
    return { markdown: textMarkdown(), method: "pdf-text", pages: numPages, warnings };
  }

  const visionSignal = budgetSignal(CV_VISION_BUDGET_MS, signal);
  try {
    const md = await withVisionFailover(visions, visionSignal, async (vision, callSignal) =>
      vision.kind === "gemini"
        ? geminiPdfToMarkdown(vision.apiKey, vision.model, buffer, callSignal)
        : visionToMarkdown(vision, callSignal, [
            {
              type: "file",
              file: {
                filename: fileName,
                file_data: `data:application/pdf;base64,${buffer.toString("base64")}`,
              },
            },
          ]),
    );
    if (md.trim().length >= MIN_CHARS_PER_PAGE) {
      log.info(`PDF extract via vision AI: ${fileName} chars=${md.length}`);
      return { markdown: md, method: "vision", pages: numPages || 1, warnings };
    }
  } catch (err) {
    if (isAbortError(err) || signal?.aborted || visionSignal.aborted) {
      log.warn("Vision PDF timed out — using pdf-parse leftover");
      warnings.push("Vision timed out — used pdf-parse text if any.");
    } else if (classifyAiFailure(err) && !textChars) {
      throw err;
    } else {
      log.warn("Vision PDF extraction failed:", err);
      warnings.push("Vision could not read this PDF — review manually.");
    }
  }

  return { markdown: textMarkdown(), method: "pdf-text", pages: numPages, warnings };
}

/* ------------------------------------------------------------------ */
/*  Images                                                             */
/* ------------------------------------------------------------------ */

async function extractImage(
  buffer: Buffer,
  organizationId?: string | null,
  signal?: AbortSignal,
): Promise<ExtractedDocument> {
  const visions = await getVisionClients(organizationId);
  if (!visions.length) {
    return {
      markdown: "",
      method: "vision",
      pages: 1,
      warnings: [
        "Image CVs need a vision model (Settings → AI OpenAI/Gemini or OPENAI_API_KEY) — review manually.",
      ],
    };
  }
  // Auto-rotate from EXIF and cap resolution: keeps OCR quality while
  // bounding memory and token cost.
  const jpeg = await sharp(buffer, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_VISION_IMAGE_PX, height: MAX_VISION_IMAGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const md = await withVisionFailover(visions, signal, (vision, callSignal) =>
    visionToMarkdown(vision, callSignal, [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" } },
    ]),
  );
  const warnings = md.length < MIN_CHARS_PER_PAGE ? ["Very little text was read from the image."] : [];
  return { markdown: md, method: "vision", pages: 1, warnings };
}

/* ------------------------------------------------------------------ */
/*  Vision helper                                                      */
/* ------------------------------------------------------------------ */

type VisionClient = {
  kind: "openai" | "gemini";
  client: OpenAI;
  model: string;
  apiKey: string;
};

/** Org Settings → AI: all OpenAI keys then Gemini keys (failover). .env only if no org vision key. */
async function getVisionClients(organizationId?: string | null): Promise<VisionClient[]> {
  const creds = await loadOrgAiCredentials(supabaseAdmin, organizationId);
  const preferOrg = (["openai", "gemini"] as const).some((id) => creds[id].from === "org");
  const out: VisionClient[] = [];

  for (const id of ["openai", "gemini"] as const) {
    const c = creds[id];
    if (!c.apiKeys.length) continue;
    if (preferOrg && c.from !== "org") continue;
    const model =
      id === "openai"
        ? process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini"
        : configuredGeminiModel();
    for (const apiKey of c.apiKeys) {
      out.push({
        kind: id,
        // maxRetries 0: we fail over across keys ourselves; SDK 429 backoff only burns the time budget.
        client: new OpenAI({ apiKey, baseURL: c.baseUrl, maxRetries: 0, fetch: unwrappingFetch }),
        model,
        apiKey,
      });
    }
  }
  return out;
}

/**
 * One attempt per key. Quota/auth on every key throws a tagged error (see `classifyAiFailure`)
 * so callers stop instead of retrying more passes.
 */
async function withVisionFailover(
  clients: VisionClient[],
  signal: AbortSignal | undefined,
  run: (c: VisionClient, callSignal: AbortSignal) => Promise<string>,
): Promise<string> {
  let lastErr: unknown;
  let sawQuota = false;
  let onlyQuotaOrAuth = true;
  for (let i = 0; i < clients.length; i++) {
    signal?.throwIfAborted();
    try {
      return await run(clients[i], budgetSignal(VISION_CALL_TIMEOUT_MS, signal));
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
      sawQuota ||= isQuotaError(err);
      onlyQuotaOrAuth &&= isQuotaError(err) || isAuthError(err);
      if (i < clients.length - 1) {
        log.warn(
          `Vision ${clients[i].kind} key #${i + 1} failed — trying next`,
          err instanceof Error ? err.message.slice(0, 120) : err,
        );
      }
    }
  }
  if (onlyQuotaOrAuth && clients.length) {
    throw keyChainExhaustedError(clients.map((c, i) => `${c.kind}#${i + 1}`).join(", "), lastErr, sawQuota, true);
  }
  throw lastErr;
}

const VISION_PROMPT = `Transcribe this document to GitHub-flavoured Markdown.
Rules:
- Preserve reading order. For multi-column layouts, finish one column before the next.
- Keep tables as Markdown tables; never merge or shift rows/columns.
- Keep headings, bullet lists, dates, numbers, emails, phone numbers and URLs exactly as printed.
- Include handwritten notes, prefixed with "[handwritten]".
- Skip repeated page headers/footers.
- If any text is unreadable write "[unreadable]" in its place. NEVER guess or invent text.
Return only the Markdown.`;

async function visionToMarkdown(
  vision: { client: OpenAI; model: string },
  signal: AbortSignal,
  parts: OpenAI.Chat.Completions.ChatCompletionContentPart[],
): Promise<string> {
  const res = await vision.client.chat.completions.create({
    model: vision.model,
    temperature: 0,
    max_tokens: 6000,
    messages: [{ role: "user", content: [{ type: "text", text: VISION_PROMPT }, ...parts] }],
  }, { signal });
  return normalise(
    (res.choices[0]?.message?.content ?? "").replace(/^```(?:markdown|md)?\s*\n?|\n?```\s*$/g, ""),
  );
}

/** Native Gemini path — OpenAI-compat rejects PDF `type:file` parts. */
async function geminiPdfToMarkdown(
  apiKey: string,
  model: string,
  buffer: Buffer,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: VISION_PROMPT },
              { inline_data: { mime_type: "application/pdf", data: buffer.toString("base64") } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 6000 },
      }),
      signal,
    },
  );
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // Keep the HTTP status so quota (429) / auth (401, 403) are recognised by classifyAiFailure.
    throw Object.assign(new Error(body || `${res.status} status code (no body)`), { status: res.status });
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return normalise(text.replace(/^```(?:markdown|md)?\s*\n?|\n?```\s*$/g, ""));
}

