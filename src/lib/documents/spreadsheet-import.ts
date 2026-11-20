/**
 * Candidate roster import (runs in the browser). xlsx@0.18.5 is unmaintained and has known
 * prototype-pollution (ODS), ReDoS (HTML) and recursion (legacy/XML) issues, so it only ever
 * sees size-capped OOXML .xlsx bytes with formula/HTML/style parsing off; CSV is parsed here
 * without SheetJS. Everything else is rejected before parsing.
 */
import * as XLSX from "xlsx";

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_COLUMNS = 30;
export const MAX_IMPORT_CELL_CHARS = 500;

export class SpreadsheetImportError extends Error {}

export interface ParsedCandidate {
  name: string;
  email?: string;
  phone?: string;
  gender?: string;
  birthday?: string;
  education?: string;
  school?: string;
  major?: string;
  graduationYear?: number;
  workExperience?: string;
}

type Cell = string | number | null;

function asciiIncludes(bytes: Uint8Array, needle: string): boolean {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/** OOXML workbook or plain CSV text; null for legacy .xls, ODS, HTML and anything else. */
export function detectSpreadsheetKind(bytes: Uint8Array): "xlsx" | "csv" | null {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (asciiIncludes(bytes, "opendocument")) return null;
    return asciiIncludes(bytes, "[Content_Types].xml") && asciiIncludes(bytes, "xl/workbook") ? "xlsx" : null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const head = text.replace(/^\uFEFF/, "").trimStart();
  if (!head || head.startsWith("<")) return null;
  if (text.includes("\u0000")) return null;
  return "csv";
}

/** RFC 4180-style CSV with row/column/cell caps. */
export function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;
  const pushCell = () => {
    if (row.length < MAX_IMPORT_COLUMNS) row.push(cell.slice(0, MAX_IMPORT_CELL_CHARS));
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length && rows.length <= MAX_IMPORT_ROWS; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else if (cell.length <= MAX_IMPORT_CELL_CHARS) {
        cell += c;
      }
    } else if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === ",") {
      pushCell();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      pushRow();
    } else if (cell.length <= MAX_IMPORT_CELL_CHARS) {
      cell += c;
    }
  }
  if (cell !== "" || row.length) pushRow();
  return rows.slice(0, MAX_IMPORT_ROWS + 1);
}

function parseXlsxRows(data: ArrayBuffer): Cell[][] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, {
      type: "array",
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellDates: false,
      bookVBA: false,
      sheetRows: MAX_IMPORT_ROWS + 50,
    });
  } catch {
    throw new SpreadsheetImportError("This spreadsheet could not be read. Save it as .xlsx or .csv and try again.");
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
  range.e.c = Math.min(range.e.c, range.s.c + MAX_IMPORT_COLUMNS - 1);
  return XLSX.utils
    .sheet_to_json<Cell[]>(ws, { header: 1, defval: "", raw: true, range })
    .map((r) => r.map((c) => (typeof c === "string" ? c.slice(0, MAX_IMPORT_CELL_CHARS) : c)));
}

export function rowsToCandidates(allRows: Cell[][]): ParsedCandidate[] {
  // Find the header row by looking for "Name" in the first cell
  let headerIndex = -1;
  for (let i = 0; i < allRows.length; i++) {
    const firstCell = String(allRows[i]?.[0] ?? "").toLowerCase().trim();
    if (firstCell === "name") {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return [];

  const headers = allRows[headerIndex].map((h) => String(h ?? "").toLowerCase().trim());

  const results: ParsedCandidate[] = [];

  for (let i = headerIndex + 1; i < allRows.length && results.length < MAX_IMPORT_ROWS; i++) {
    const row = allRows[i];
    if (!row || row.every((c) => !c && c !== 0)) continue;

    // Plain object without a prototype: header text can't reach Object.prototype.
    const normalized: Record<string, string> = Object.create(null);
    headers.forEach((key, idx) => {
      normalized[key] = String(row[idx] ?? "").trim();
    });

    const name = normalized["name"] || "";
    if (!name) continue;

    const candidate: ParsedCandidate = { name };

    const email = normalized["email"] || normalized["e-mail"] || "";
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      candidate.email = email.toLowerCase();
    }

    if (normalized["phone"]) candidate.phone = normalized["phone"];
    if (normalized["gender"]) candidate.gender = normalized["gender"];
    if (normalized["birthday"]) candidate.birthday = normalized["birthday"];
    if (normalized["education"]) candidate.education = normalized["education"];
    if (normalized["school"]) candidate.school = normalized["school"];
    if (normalized["major"]) candidate.major = normalized["major"];

    const gradYear = normalized["graduation year"] || normalized["graduationyear"] || "";
    if (gradYear) {
      const yr = parseInt(gradYear, 10);
      if (!isNaN(yr)) candidate.graduationYear = yr;
    }

    const workExp = normalized["work experience"] || normalized["workexperience"] || "";
    if (workExp) candidate.workExperience = workExp;

    results.push(candidate);
  }

  return results;
}

export function parseCandidateSpreadsheet(data: ArrayBuffer): ParsedCandidate[] {
  if (data.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new SpreadsheetImportError(`File is too large (max ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB).`);
  }
  const bytes = new Uint8Array(data);
  const kind = detectSpreadsheetKind(bytes);
  if (!kind) throw new SpreadsheetImportError("Unsupported file. Upload an .xlsx workbook or a UTF-8 .csv file.");
  const rows = kind === "csv" ? parseCsv(new TextDecoder("utf-8").decode(bytes)) : parseXlsxRows(data);
  return rowsToCandidates(rows);
}
