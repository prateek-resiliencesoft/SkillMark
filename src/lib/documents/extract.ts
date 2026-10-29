/**
 * Layout-aware document → Markdown extraction (server-only).
 *
 * Tiered so the expensive path only runs when the cheap one can't read the file:
 *   1. Docling Serve (optional, DOCLING_SERVE_URL) — layout-aware parsing with
 *      reading order, multi-column, tables and built-in OCR for scans.
 *   2. Native text layers — DOCX via mammoth (keeps headings/lists/tables),
 *      PDF via pdf-parse page by page.
 *   3. Vision LLM — only for images and PDF pages without a usable text layer.
 *
 * Nothing here guesses: unreadable input is reported in `warnings` so callers
 * can flag the document for human review.
 */
import "server-only";
import type { AnyNode, Element } from "domhandler";
import { getChildren, getElementsByTagName, textContent } from "domutils";
import { parseDocument } from "htmlparser2";
import OpenAI from "openai";
import sharp from "sharp";
import { createLogger } from "@/lib/logger";

const log = createLogger("documents/extract");

// Import the library entry directly: the package index runs a debug self-test
// when it has no parent module (tsx, workers).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer,
  options?: { pagerender?: (page: PdfPage) => Promise<string> },
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
): Promise<ExtractedDocument> {
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`File is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
  }
  const kind = detectKind(fileName, mime, buffer);
  if (!kind) throw new Error("Unsupported file type. Use PDF, DOCX, TXT or an image.");

  if (kind === "text") {
    return { markdown: normalise(buffer.toString("utf8")), method: "plain-text", pages: 1, warnings: [] };
  }

  if (process.env.DOCLING_SERVE_URL) {
    try {
      const md = await extractWithDocling(buffer, fileName);
      if (md.trim().length >= MIN_CHARS_PER_PAGE) {
        return { markdown: md, method: "docling", pages: countPages(md), warnings: [] };
      }
    } catch (err) {
      log.warn("Docling failed, falling back to native extraction:", err);
    }
  }

  if (kind === "docx") return extractDocx(buffer);
  if (kind === "pdf") return extractPdf(buffer, fileName);
  return extractImage(buffer);
}

/* ------------------------------------------------------------------ */
/*  Docling Serve                                                      */
/* ------------------------------------------------------------------ */

async function extractWithDocling(buffer: Buffer, fileName: string): Promise<string> {
  const base = process.env.DOCLING_SERVE_URL!.replace(/\/$/, "");
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buffer)]), fileName);
  form.append("to_formats", "md");
  form.append("do_ocr", "true");
  form.append("table_mode", "accurate");
  form.append("image_export_mode", "placeholder");

  const res = await fetch(`${base}/v1/convert/file`, {
    method: "POST",
    body: form,
    headers: process.env.DOCLING_SERVE_API_KEY ? { "X-Api-Key": process.env.DOCLING_SERVE_API_KEY } : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Docling HTTP ${res.status}`);
  const json = (await res.json()) as { document?: { md_content?: string }; status?: string };
  return normalise(json.document?.md_content ?? "");
}

/* ------------------------------------------------------------------ */
/*  DOCX                                                               */
/* ------------------------------------------------------------------ */

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
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

/**
 * Converts mammoth's semantic HTML to Markdown, keeping table rows intact.
 * Uses htmlparser2 rather than cheerio: cheerio pulls in the `undici` package,
 * which breaks pdf-parse's bundled pdf.js ("bad XRef entry") in the same process.
 */
function htmlToMarkdown(html: string): string {
  const isTag = (n: AnyNode): n is Element => "name" in n && typeof n.name === "string";
  const text = (n: AnyNode) => textContent(n).replace(/\s+/g, " ").trim();
  const out: string[] = [];

  for (const el of getChildren(parseDocument(html))) {
    if (!isTag(el)) {
      const t = text(el);
      if (t) out.push(t, "");
      continue;
    }
    const tag = el.name.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      out.push(`${"#".repeat(Number(tag[1]))} ${text(el)}`);
    } else if (tag === "ul" || tag === "ol") {
      getChildren(el)
        .filter((c) => isTag(c) && c.name === "li")
        .forEach((li, i) => out.push(`${tag === "ol" ? `${i + 1}.` : "-"} ${text(li)}`));
    } else if (tag === "table") {
      const rows = getElementsByTagName("tr", el).map((tr) =>
        getChildren(tr)
          .filter((c) => isTag(c) && (c.name === "td" || c.name === "th"))
          .map((c) => text(c).replace(/\|/g, "\\|")),
      );
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
        out.push(`| ${pad(rows[0]).join(" | ")} |`);
        out.push(`| ${Array(width).fill("---").join(" | ")} |`);
        for (const r of rows.slice(1)) out.push(`| ${pad(r).join(" | ")} |`);
      }
    } else {
      const t = text(el);
      if (t) out.push(t);
    }
    out.push("");
  }

  return normalise(out.join("\n"));
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

async function extractPdf(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  const warnings: string[] = [];
  let pages: string[] = [];
  let numPages = 0;

  try {
    const parsed = await pdfParse(buffer, { pagerender: renderPdfPage });
    numPages = parsed.numpages;
    pages = parsed.text.split("\f").map((p) => p.trim()).filter((_, i) => i < numPages);
  } catch (err) {
    log.warn("pdf-parse failed:", err);
    warnings.push("PDF text layer could not be read.");
  }

  const scannedPages = pages.filter((p) => p.length < MIN_CHARS_PER_PAGE).length;
  const textChars = pages.reduce((n, p) => n + p.length, 0);

  // Mostly text: done, no vision call.
  if (pages.length > 0 && scannedPages === 0) {
    return {
      markdown: normalise(pages.map((p, i) => `<!-- page ${i + 1} -->\n${p}`).join("\n\n")),
      method: "pdf-text",
      pages: numPages,
      warnings,
    };
  }

  // Some or all pages are scans: ask the vision model to read the PDF.
  const vision = getVisionClient();
  if (!vision) {
    warnings.push(
      `${scannedPages || "All"} page(s) look scanned and no vision model is configured (OPENAI_API_KEY) — review manually.`,
    );
    return { markdown: normalise(pages.join("\n\n")), method: "pdf-text", pages: numPages, warnings };
  }

  try {
    const md = await visionToMarkdown(vision, [
      {
        type: "file",
        file: { filename: fileName, file_data: `data:application/pdf;base64,${buffer.toString("base64")}` },
      },
    ]);
    // Keep whichever reading has more content; vision may skip clean text pages.
    if (md.length >= textChars) {
      return { markdown: md, method: "vision", pages: numPages, warnings };
    }
  } catch (err) {
    log.warn("Vision PDF extraction failed:", err);
    warnings.push("Scanned pages could not be read by the vision model — review manually.");
  }
  if (scannedPages > 0) warnings.push(`${scannedPages} page(s) have no text layer and may be incomplete.`);
  return { markdown: normalise(pages.join("\n\n")), method: "pdf-text", pages: numPages, warnings };
}

/* ------------------------------------------------------------------ */
/*  Images                                                             */
/* ------------------------------------------------------------------ */

async function extractImage(buffer: Buffer): Promise<ExtractedDocument> {
  const vision = getVisionClient();
  if (!vision) {
    return {
      markdown: "",
      method: "vision",
      pages: 1,
      warnings: ["Image CVs need a vision model (OPENAI_API_KEY) or DOCLING_SERVE_URL — review manually."],
    };
  }
  // Auto-rotate from EXIF and cap resolution: keeps OCR quality while
  // bounding memory and token cost.
  const jpeg = await sharp(buffer, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_VISION_IMAGE_PX, height: MAX_VISION_IMAGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const md = await visionToMarkdown(vision, [
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" } },
  ]);
  const warnings = md.length < MIN_CHARS_PER_PAGE ? ["Very little text was read from the image."] : [];
  return { markdown: md, method: "vision", pages: 1, warnings };
}

/* ------------------------------------------------------------------ */
/*  Vision helper                                                      */
/* ------------------------------------------------------------------ */

function getVisionClient(): { client: OpenAI; model: string } | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return {
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL }),
    model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
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
  parts: OpenAI.Chat.Completions.ChatCompletionContentPart[],
): Promise<string> {
  const res = await vision.client.chat.completions.create({
    model: vision.model,
    temperature: 0,
    max_tokens: 6000,
    messages: [{ role: "user", content: [{ type: "text", text: VISION_PROMPT }, ...parts] }],
  });
  return normalise(
    (res.choices[0]?.message?.content ?? "").replace(/^```(?:markdown|md)?\s*\n?|\n?```\s*$/g, ""),
  );
}

/* ------------------------------------------------------------------ */

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}(?!\|)/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countPages(md: string): number {
  return Math.max(1, (md.match(/<!-- page/g) ?? []).length);
}
