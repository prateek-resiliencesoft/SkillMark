import type { AnyNode, Element } from "domhandler";
import { getChildren, getElementsByTagName, textContent } from "domutils";
import { parseDocument } from "htmlparser2";
import { inflateRawSync } from "node:zlib";

const MAX_ZIP_ENTRIES = 2000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
const MAX_ZIP_RATIO = 200;
export const MAX_TABLE_ROWS = 1000;
export const MAX_TABLE_COLUMNS = 50;
export const MAX_MARKDOWN_CHARS = 500_000;

export function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}(?!\|)/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Rejects ZIP bombs before mammoth/JSZip inflate the archive in memory. Every entry is
 * inflated with a hard output cap, since central-directory sizes are attacker-declared.
 */
export function assertZipWithinLimits(buffer: Buffer): void {
  const fail = (why: string): never => {
    throw new Error(`DOCX rejected: ${why}`);
  };
  if (buffer.length < 22) fail("not a valid ZIP archive");
  const minEocd = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minEocd; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("not a valid ZIP archive");
  const entries = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) fail("ZIP64 archives are not supported");
  if (entries > MAX_ZIP_ENTRIES) fail("too many entries");

  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) fail("corrupt central directory");
    const method = buffer.readUInt16LE(p + 10);
    const compressed = buffer.readUInt32LE(p + 20);
    const local = buffer.readUInt32LE(p + 42);
    p += 46 + buffer.readUInt16LE(p + 28) + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);

    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) fail("corrupt local header");
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (dataStart + compressed > buffer.length) fail("truncated entry");

    let size = compressed;
    if (method === 8) {
      const remaining = MAX_ZIP_UNCOMPRESSED_BYTES - total;
      try {
        size = inflateRawSync(buffer.subarray(dataStart, dataStart + compressed), {
          maxOutputLength: Math.max(1, remaining),
        }).length;
      } catch {
        fail("entry expands beyond the allowed size or is corrupt");
      }
    } else if (method !== 0) {
      fail("unsupported compression method");
    }
    if (size > 1024 * 1024 && size / Math.max(1, compressed) > MAX_ZIP_RATIO) fail("suspicious compression ratio");
    total += size;
    if (total > MAX_ZIP_UNCOMPRESSED_BYTES) fail("archive expands beyond the allowed size");
  }
}

/**
 * Converts mammoth's semantic HTML to Markdown, keeping table rows intact. Tables are
 * capped in rows/columns so sparse wide tables can't amplify the output.
 * Uses htmlparser2 rather than cheerio: cheerio pulls in the `undici` package,
 * which breaks pdf-parse's bundled pdf.js ("bad XRef entry") in the same process.
 */
export function htmlToMarkdown(html: string): string {
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
      const rows = getElementsByTagName("tr", el, true, MAX_TABLE_ROWS).map((tr) =>
        getChildren(tr)
          .filter((c) => isTag(c) && (c.name === "td" || c.name === "th"))
          .slice(0, MAX_TABLE_COLUMNS)
          .map((c) => text(c).replace(/\|/g, "\\|")),
      );
      if (rows.length) {
        const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
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

  return normalise(out.join("\n")).slice(0, MAX_MARKDOWN_CHARS);
}
