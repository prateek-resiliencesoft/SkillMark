import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("extractPdf: pdf-parse then vision (no Docling)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/documents/extract.ts"), "utf8");
  assert.doesNotMatch(src, /docling|Docling|DOCLING/i);
  const pdfFn = src.slice(src.indexOf("async function extractPdf"), src.indexOf("async function extractImage"));
  const parseIdx = pdfFn.indexOf("pdfParse");
  const visionIdx = pdfFn.indexOf("getVisionClients");
  assert.ok(parseIdx > 0, "pdf-parse missing");
  assert.ok(visionIdx > parseIdx, "vision only after pdf-parse");
});

test("parse-cv extract budget leaves room for profile", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/api/batches/parse-cv/route.ts"), "utf8");
  assert.match(src, /EXTRACT_BUDGET_MS = 45_000/);
});
