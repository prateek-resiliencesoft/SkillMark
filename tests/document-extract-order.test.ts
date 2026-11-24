import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards the fast-path contract: digital PDFs with a text layer must not require
 * DOCLING_SERVE_URL. We assert the source still tries native pdf-parse before Docling.
 */
test("extract.ts prefers native PDF text before Docling", () => {
  const src = readFileSync(
    path.join(process.cwd(), "src/lib/documents/extract.ts"),
    "utf8",
  );
  const nativeMarker = src.indexOf("Cheap native path first");
  const doclingFirst = src.indexOf("if (process.env.DOCLING_SERVE_URL)");
  const tryDoclingDef = src.indexOf("async function tryDocling");
  assert.ok(nativeMarker > 0, "native-first comment missing");
  assert.ok(tryDoclingDef > 0, "tryDocling helper missing");
  // Old Docling-first gate at top of extractDocument must be gone.
  const extractFn = src.slice(src.indexOf("export async function extractDocument"), tryDoclingDef);
  assert.equal(
    /if \(process\.env\.DOCLING_SERVE_URL\)/.test(extractFn),
    false,
    "extractDocument must not call Docling before native text",
  );
  assert.ok(src.includes("table_mode"), "docling form still configured");
  assert.ok(src.includes('"fast"'), "docling table_mode should be fast");
  void doclingFirst;
});
