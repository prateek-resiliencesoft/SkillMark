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
});

test("extract.ts uses pdf-parse before Docling so bulk CV stays under budget", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/documents/extract.ts"), "utf8");
  assert.ok(src.includes("extractWithDoclingPython"), "Python Docling path missing");

  const pdfFn = src.slice(src.indexOf("async function extractPdf"), src.indexOf("async function extractImage"));
  const parseIdx = pdfFn.indexOf("pdfParse");
  const doclingIdx = pdfFn.indexOf("tryDocling");
  assert.ok(parseIdx > 0, "pdf-parse missing");
  assert.ok(doclingIdx > parseIdx, "Docling must run after pdf-parse for PDFs");
  assert.match(src, /DOCLING_OCR_BUDGET_MS = 20_000/);
});
