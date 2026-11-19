/**
 * Parse a single-range HTTP `Range` header (`bytes=start-end`, `bytes=start-`,
 * `bytes=-suffix`) against a file size. Multi-range requests are served whole.
 */
export type ByteRange = { start: number; end: number };

export function parseRangeHeader(header: string | null | undefined, size: number): ByteRange | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return header.includes(",") ? null : "invalid";
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  if (size <= 0) return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}
