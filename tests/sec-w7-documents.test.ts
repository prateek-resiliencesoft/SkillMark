import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import {
  assertZipWithinLimits,
  htmlToMarkdown,
  MAX_MARKDOWN_CHARS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
} from "@/lib/documents/docx-safety";
import {
  MAX_IMPORT_FILE_BYTES,
  parseCandidateSpreadsheet,
  SpreadsheetImportError,
} from "@/lib/documents/spreadsheet-import";

/** Minimal ZIP writer; `declaredSize` lets a test lie in the central directory like an attacker would. */
function zip(entries: { name: string; data: Buffer; declaredSize?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const comp = deflateRawSync(e.data);
    const size = e.declaredSize ?? e.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe("DOCX ZIP-bomb guard", () => {
  it("accepts a normal small archive", () => {
    assert.doesNotThrow(() =>
      assertZipWithinLimits(zip([{ name: "word/document.xml", data: Buffer.from("<w:document>hello</w:document>".repeat(200)) }])),
    );
  });

  it("rejects an entry that inflates past the cap even when its declared size is tiny", () => {
    const bomb = zip([{ name: "word/document.xml", data: Buffer.alloc(80 * 1024 * 1024), declaredSize: 100 }]);
    assert.ok(bomb.length < 200 * 1024, "compressed bomb is small");
    assert.throws(() => assertZipWithinLimits(bomb), /DOCX rejected/);
  });

  it("rejects extreme compression ratios and junk", () => {
    assert.throws(() => assertZipWithinLimits(zip([{ name: "a.xml", data: Buffer.alloc(20 * 1024 * 1024) }])), /ratio/);
    assert.throws(() => assertZipWithinLimits(Buffer.from("not a zip")), /DOCX rejected/);
  });
});

describe("DOCX table amplification", () => {
  it("caps rows, columns and total output", () => {
    const wide = `<tr>${"<td>x</td>".repeat(5000)}</tr>`;
    const tall = "<tr><td>y</td></tr>".repeat(5000);
    const md = htmlToMarkdown(`<table>${wide}${tall}</table>`);
    const tableLines = md.split("\n").filter((l) => l.startsWith("|"));
    assert.ok(tableLines.length <= MAX_TABLE_ROWS + 1);
    assert.ok(tableLines.every((l) => l.split(" | ").length <= MAX_TABLE_COLUMNS));
    assert.ok(md.length <= MAX_MARKDOWN_CHARS);
  });
});

describe("candidate spreadsheet import (xlsx@0.18.5 mitigation)", () => {
  const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

  it("parses CSV without SheetJS and ignores prototype-style headers", () => {
    const rows = parseCandidateSpreadsheet(enc('Name,Email,__proto__\n"Jane, Q",jane@example.com,polluted\n'));
    assert.deepEqual(rows, [{ name: "Jane, Q", email: "jane@example.com" }]);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(({} as Record<string, unknown>)["!autofilter"], undefined);
  });

  it("parses a real .xlsx workbook", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Name", "Email"], ["Bob", "bob@example.com"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    assert.deepEqual(parseCandidateSpreadsheet(out), [{ name: "Bob", email: "bob@example.com" }]);
  });

  it("rejects ODS, legacy .xls, HTML and oversized files before parsing", () => {
    const odsBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(odsBook, XLSX.utils.aoa_to_sheet([["Name"], ["Eve"]]), "S");
    const ods = XLSX.write(odsBook, { type: "array", bookType: "ods" }) as ArrayBuffer;
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]).buffer;
    const html = enc(`<table>${"<table>".repeat(5000)}`);
    for (const [label, data] of [["ods", ods], ["xls", cfb], ["html", html]] as const) {
      assert.throws(() => parseCandidateSpreadsheet(data), SpreadsheetImportError, label);
    }
    assert.throws(() => parseCandidateSpreadsheet(new ArrayBuffer(MAX_IMPORT_FILE_BYTES + 1)), /too large/);
  });
});
