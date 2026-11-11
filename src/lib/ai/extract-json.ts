import { createLogger } from "@/lib/logger";

const log = createLogger("ai/extract-json");

/**
 * Robustly extract and parse a JSON object from an AI response string.
 *
 * Handles common issues:
 * - Unicode smart / curly quotes → ASCII `"`
 * - Markdown code fences
 * - Trailing commas before `]` / `}`
 * - Unescaped newlines / interior quotes in strings
 * - Truncated objects (best-effort close of open braces/brackets)
 */
export function extractJson<T = Record<string, unknown>>(raw: string): T {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
  if (codeBlock) {
    text = codeBlock[1].trim();
  } else {
    text = text.replace(/```(?:json)?/gi, "");
  }

  const candidate = extractBalancedObject(text);
  if (!candidate) {
    throw new Error("No JSON object found in AI response");
  }

  const attempts = [
    candidate,
    stripTrailingCommas(candidate),
    sanitiseJsonString(stripTrailingCommas(candidate)),
    closeTruncatedJson(stripTrailingCommas(candidate)),
    sanitiseJsonString(closeTruncatedJson(stripTrailingCommas(candidate))),
  ];

  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as T;
    } catch (e) {
      lastErr = e;
    }
  }

  log.error(
    "Failed to parse after sanitisation. First 500 chars:",
    candidate.slice(0, 500),
  );
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to parse AI response as JSON");
}

/** First balanced `{...}` (string-aware). Truncated → slice from `{` for repair. */
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  // Truncated — return from `{` to end for repair attempts
  return text.slice(start);
}

function stripTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Best-effort close of truncated JSON: end open string, then close brackets/braces
 * in reverse open order.
 */
function closeTruncatedJson(raw: string): string {
  let inStr = false;
  let esc = false;
  const stack: ("{" | "[")[] = [];

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("{");
    else if (c === "[") stack.push("[");
    else if (c === "}" || c === "]") stack.pop();
  }

  let out = raw;
  if (inStr) out += '"';
  // Drop dangling comma before we close
  out = out.replace(/,\s*$/, "");
  while (stack.length) {
    const open = stack.pop();
    out += open === "{" ? "}" : "]";
  }
  return out;
}

/**
 * Walk through the raw JSON character-by-character, escaping unescaped
 * control characters and quotes that appear inside string values.
 */
function sanitiseJsonString(raw: string): string {
  const input = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  const out: string[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    if (ch === '"') {
      out.push('"');
      i++;
      const strChars: string[] = [];
      while (i < len) {
        const sc = input[i];
        if (sc === "\\") {
          strChars.push(sc);
          i++;
          if (i < len) {
            strChars.push(input[i]);
            i++;
          }
        } else if (sc === '"') {
          const after = input.slice(i + 1).match(/^\s*(.)/);
          const nextSignificant = after ? after[1] : "";
          if (
            nextSignificant === "," ||
            nextSignificant === "}" ||
            nextSignificant === "]" ||
            nextSignificant === ":" ||
            nextSignificant === ""
          ) {
            break;
          } else {
            strChars.push('\\"');
            i++;
          }
        } else if (sc === "\n") {
          strChars.push("\\n");
          i++;
        } else if (sc === "\r") {
          strChars.push("\\r");
          i++;
        } else if (sc === "\t") {
          strChars.push("\\t");
          i++;
        } else {
          strChars.push(sc);
          i++;
        }
      }
      out.push(strChars.join(""));
      out.push('"');
      i++;
    } else {
      out.push(ch);
      i++;
    }
  }

  return out.join("");
}
