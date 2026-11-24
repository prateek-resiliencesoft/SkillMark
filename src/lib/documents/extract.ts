/**
 * Layout-aware document → Markdown extraction (server-only).
 *
 * Fast path first (bulk CV must finish under ~75s including profile LLM):
 *   PDF:  pdf-parse → Docling OCR (only if thin/scanned) → vision
 *   DOCX: mammoth → Docling if thin
 *   Image: Docling OCR → vision
 *
 * Docling = local Python (`scripts/docling_extract.py`); optional Serve URL
 * if the package is missing. Install: `pip install -r requirements-docling.txt`
 *
 * Nothing here guesses: unreadable input is reported in `warnings` so callers
 * can flag the document for human review.
 */
import { configuredGeminiModel } from "@/lib/ai/gemini-models";
import { unwrappingFetch } from "@/lib/ai/providers/compatible";
import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { loadOrgAiCredentials } from "@/lib/ai/credentials";
import { assertZipWithinLimits, htmlToMarkdown, normalise } from "@/lib/documents/docx-safety";
import { budgetSignal, VISION_CALL_TIMEOUT_MS } from "@/lib/ai/fail-fast";
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

export type ExtractionMethod = "docling" | "docx" | "pdf-text" | "vision" | "plain-text";

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
    const native = await extractDocx(buffer);
    if (native.markdown.trim().length >= MIN_CHARS_PER_PAGE) return native;
    const viaDocling = await tryDocling(buffer, fileName, options?.signal, { ocr: true });
    if (viaDocling && viaDocling.markdown.length > native.markdown.length) return viaDocling;
    return native;
  }

  if (kind === "pdf") {
    return extractPdf(buffer, fileName, options?.organizationId, options?.signal);
  }

  // Images need OCR — Docling before vision LLM.
  const viaDocling = await tryDocling(buffer, fileName, options?.signal, { ocr: true });
  if (viaDocling && viaDocling.markdown.trim().length >= MIN_CHARS_PER_PAGE) return viaDocling;
  return extractImage(buffer, options?.organizationId, options?.signal);
}

/* ------------------------------------------------------------------ */
/*  Docling (local Python library first; optional Serve fallback)      */
/* ------------------------------------------------------------------ */

/**
 * Keep Docling short — cold model load alone can exceed the parse-cv budget.
 * Native text is preferred; Docling is only for thin/scanned leftovers.
 */
const DOCLING_FAST_BUDGET_MS = 12_000;
const DOCLING_OCR_BUDGET_MS = 20_000;

type DoclingOpts = {
  /** false = born-digital fast path (skip OCR). true = scan/image OCR. */
  ocr: boolean;
};

/** Cached: null = not probed, true/false = import docling works. */
let doclingPythonOk: boolean | null = null;

function doclingPythonBin(): string {
  if (process.env.DOCLING_PYTHON?.trim()) return process.env.DOCLING_PYTHON.trim();
  // Prefer project venv when present (PEP 668 / local install).
  const venvPy = path.join(process.cwd(), ".venv-docling", "bin", "python");
  if (existsSync(venvPy)) return venvPy;
  return "python3";
}

function doclingScriptPath(): string {
  return path.join(process.cwd(), "scripts", "docling_extract.py");
}

function runProcess(
  cmd: string,
  args: string[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      child.kill("SIGKILL");
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Docling timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr });
    });
  });
}

async function probeDoclingPython(): Promise<boolean> {
  if (process.env.DOCLING_DISABLE === "1") {
    doclingPythonOk = false;
    return false;
  }
  if (doclingPythonOk != null) return doclingPythonOk;
  try {
    const r = await runProcess(
      doclingPythonBin(),
      ["-c", "import docling"],
      undefined,
      15_000,
    );
    doclingPythonOk = r.code === 0;
  } catch {
    doclingPythonOk = false;
  }
  if (!doclingPythonOk) {
    log.warn(
      "Docling Python package not available — install with: pip install -r requirements-docling.txt",
    );
  }
  return doclingPythonOk;
}

/** Local Docling via `scripts/docling_extract.py`. */
async function extractWithDoclingPython(
  buffer: Buffer,
  fileName: string,
  signal: AbortSignal | undefined,
  opts: DoclingOpts,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "skillmark-docling-"));
  const ext = path.extname(fileName) || ".pdf";
  const safeExt = /^\.(pdf|docx|png|jpe?g|webp|tiff?|bmp)$/i.test(ext) ? ext : ".pdf";
  const filePath = path.join(dir, `doc${safeExt}`);
  await writeFile(filePath, buffer);
  try {
    const args = [
      doclingScriptPath(),
      filePath,
      `--max-pages=${MAX_PDF_PAGES}`,
      ...(opts.ocr ? ["--ocr"] : []),
    ];
    const budget = budgetSignal(opts.ocr ? DOCLING_OCR_BUDGET_MS : DOCLING_FAST_BUDGET_MS, signal);
    const r = await runProcess(doclingPythonBin(), args, budget, opts.ocr ? DOCLING_OCR_BUDGET_MS : DOCLING_FAST_BUDGET_MS);
    if (r.code !== 0) {
      if (/No module named ['"]docling['"]/i.test(r.stderr)) doclingPythonOk = false;
      throw new Error(r.stderr.trim() || `docling_extract exited ${r.code}`);
    }
    return normalise(r.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Optional HTTP fallback when Python Docling is missing. */
async function extractWithDoclingServe(
  buffer: Buffer,
  fileName: string,
  signal: AbortSignal | undefined,
  opts: DoclingOpts,
): Promise<string> {
  const base = process.env.DOCLING_SERVE_URL!.replace(/\/$/, "");
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buffer)]), fileName);
  form.append("to_formats", "md");
  form.append("do_ocr", opts.ocr ? "true" : "false");
  form.append("force_ocr", "false");
  form.append("table_mode", "fast");
  form.append("image_export_mode", "placeholder");
  form.append("page_range", JSON.stringify([1, MAX_PDF_PAGES]));

  const res = await fetch(`${base}/v1/convert/file`, {
    method: "POST",
    body: form,
    headers: process.env.DOCLING_SERVE_API_KEY ? { "X-Api-Key": process.env.DOCLING_SERVE_API_KEY } : undefined,
    signal: budgetSignal(opts.ocr ? DOCLING_OCR_BUDGET_MS : DOCLING_FAST_BUDGET_MS, signal),
  });
  if (!res.ok) throw new Error(`Docling HTTP ${res.status}`);
  const json = (await res.json()) as { document?: { md_content?: string }; status?: string };
  return normalise(json.document?.md_content ?? "");
}

/** Soft Docling attempt — never throws unless the caller signal aborted. */
async function tryDocling(
  buffer: Buffer,
  fileName: string,
  signal: AbortSignal | undefined,
  opts: DoclingOpts,
): Promise<ExtractedDocument | null> {
  try {
    let md = "";
    if (await probeDoclingPython()) {
      md = await extractWithDoclingPython(buffer, fileName, signal, opts);
    } else if (process.env.DOCLING_SERVE_URL?.trim()) {
      md = await extractWithDoclingServe(buffer, fileName, signal, opts);
    } else {
      return null;
    }
    if (md.trim().length < MIN_CHARS_PER_PAGE) return null;
    return { markdown: md, method: "docling", pages: countPages(md), warnings: [] };
  } catch (err) {
    if (signal?.aborted) throw err;
    log.warn(`Docling ${opts.ocr ? "OCR" : "fast"} failed, continuing:`, err);
    return null;
  }
}

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

  // 1) Native text layer first — most digital CVs finish in ms (no Docling cold start).
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

  if (pages.length > 0 && scannedPages === 0) {
    return {
      markdown: normalise(pages.map((p, i) => `<!-- page ${i + 1} -->\n${p}`).join("\n\n")),
      method: "pdf-text",
      pages: numPages,
      warnings,
    };
  }

  // 2) Thin / scanned: short Docling OCR attempt (must not burn the whole 75s budget).
  signal?.throwIfAborted();
  const viaDocling = await tryDocling(buffer, fileName, signal, { ocr: true });
  if (viaDocling && viaDocling.markdown.length >= Math.max(textChars, MIN_CHARS_PER_PAGE)) {
    return { ...viaDocling, pages: numPages || viaDocling.pages, warnings };
  }

  // 3) Vision LLM last resort.
  const visions = await getVisionClients(organizationId);
  if (!visions.length) {
    warnings.push(
      `${scannedPages || "All"} page(s) look scanned and no vision model is configured (Settings → AI OpenAI/Gemini, or OPENAI_API_KEY) — review manually.`,
    );
    return { markdown: normalise(pages.join("\n\n")), method: "pdf-text", pages: numPages, warnings };
  }

  try {
    // Gemini's OpenAI-compat rejects `type:file`; use native generateContent + inline PDF.
    const md = await withVisionFailover(visions, signal, async (vision, callSignal) =>
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
    // Keep whichever reading has more content; vision may skip clean text pages.
    if (md.length >= textChars) {
      return { markdown: md, method: "vision", pages: numPages, warnings };
    }
  } catch (err) {
    // Budget spent, or no key can serve vision and there is no text layer to fall back on.
    if (signal?.aborted || (classifyAiFailure(err) && !textChars)) throw err;
    log.warn("Vision PDF extraction failed:", err);
    warnings.push("Scanned pages could not be read by the vision model — review manually.");
  }
  if (scannedPages > 0) warnings.push(`${scannedPages} page(s) have no text layer and may be incomplete.`);
  return { markdown: normalise(pages.join("\n\n")), method: "pdf-text", pages: numPages, warnings };
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
        "Image CVs need a vision model (Settings → AI OpenAI/Gemini, OPENAI_API_KEY, or DOCLING_SERVE_URL) — review manually.",
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

/* ------------------------------------------------------------------ */

function countPages(md: string): number {
  return Math.max(1, (md.match(/<!-- page/g) ?? []).length);
}
