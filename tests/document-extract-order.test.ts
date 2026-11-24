import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

test("docling_extract.py CLI exists for local Python Docling", () => {
  const script = path.join(process.cwd(), "scripts", "docling_extract.py");
  assert.ok(existsSync(script), "scripts/docling_extract.py missing");
  const py = readFileSync(script, "utf8");
  assert.match(py, /DocumentConverter/);
  assert.match(py, /do_ocr/);
  assert.match(py, /TableFormerMode\.FAST/);
});

test("extract.ts prefers local Python Docling before Serve URL", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/documents/extract.ts"), "utf8");
  assert.ok(src.includes("extractWithDoclingPython"), "Python Docling path missing");
  assert.ok(src.includes("docling_extract.py"), "CLI script path missing");
  assert.ok(src.includes("probeDoclingPython"), "availability probe missing");

  const pdfFn = src.slice(src.indexOf("async function extractPdf"), src.indexOf("async function extractImage"));
  const fastIdx = pdfFn.indexOf("ocr: false");
  const ocrIdx = pdfFn.indexOf("ocr: true");
  const parseIdx = pdfFn.indexOf("pdfParse");
  assert.ok(fastIdx > 0 && ocrIdx > fastIdx, "PDF: Docling fast before OCR");
  assert.ok(parseIdx > ocrIdx, "PDF: pdf-parse after Docling");
});
