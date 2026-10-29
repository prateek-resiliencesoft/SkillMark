import { getAuthUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { findAll, findOne, removeElement, textContent } from "domutils";
import { parseDocument } from "htmlparser2";

const log = createLogger("api/ai/extract-text");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
) => Promise<{ text: string }>;

const MAX_TEXT_LENGTH = 15_000;

function truncate(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return text.slice(0, MAX_TEXT_LENGTH) + "\n\n[...truncated]";
}

const STRIPPED_TAGS = new Set(["script", "style", "noscript", "svg", "img", "video", "audio", "iframe", "nav", "footer", "header"]);

// htmlparser2 instead of cheerio: cheerio loads the `undici` package, which
// breaks pdf-parse's bundled pdf.js ("bad XRef entry") for the whole process.
function htmlToText(html: string): string {
  const doc = parseDocument(html);
  for (const el of findAll((e) => STRIPPED_TAGS.has(e.name), doc.children)) removeElement(el);

  const pick = (test: Parameters<typeof findOne>[0]) => {
    const el = findOne(test, doc.children);
    return el ? textContent(el) : "";
  };
  const mainContent =
    pick((e) => e.name === "main") ||
    pick((e) => e.name === "article") ||
    pick((e) => e.attribs.role === "main") ||
    pick((e) => e.name === "body") ||
    textContent(doc);

  return mainContent
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(req: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const url = formData.get("url") as string | null;

    if (!file && !url) {
      return Response.json(
        { error: "Provide either a PDF file or a URL" },
        { status: 400 },
      );
    }

    let extractedText: string;

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const pdfData = await pdfParse(buffer);
      extractedText = pdfData.text?.trim() ?? "";

      if (!extractedText) {
        return Response.json(
          { error: "Could not extract text from the PDF" },
          { status: 400 },
        );
      }
    } else {
      const targetUrl = url!.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        return Response.json(
          { error: "Invalid URL — must start with http:// or https://" },
          { status: 400 },
        );
      }

      const res = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AuralBot/1.0; +https://aural.app)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        return Response.json(
          { error: `Failed to fetch URL (HTTP ${res.status})` },
          { status: 400 },
        );
      }

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("application/pdf")) {
        const buffer = Buffer.from(await res.arrayBuffer());
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text?.trim() ?? "";
      } else {
        const html = await res.text();
        extractedText = htmlToText(html);
      }

      if (!extractedText) {
        return Response.json(
          { error: "Could not extract meaningful text from the URL" },
          { status: 400 },
        );
      }
    }

    return Response.json({ text: truncate(extractedText) });
  } catch (err) {
    log.error("Text extraction error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
