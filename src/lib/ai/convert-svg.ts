import sharp from "sharp";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai/convert-svg");

/** Whiteboard SVGs are candidate-supplied; a tiny SVG can declare a huge canvas. */
export const MAX_SVG_BYTES = 2 * 1024 * 1024;
export const MAX_SVG_INPUT_PIXELS = 16_000_000;
export const MAX_RASTER_EDGE = 2000;
const MAX_INLINE_IMAGE_CHARS = 4_000_000;
const MAX_CONCURRENT = 2;

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * Convert an SVG data URL to a PNG data URL for the LLM. Raster data URLs pass
 * through; anything else (remote URLs, oversized or unrenderable SVGs) is null so
 * the raw payload never reaches the prompt.
 */
export async function svgDataUrlToPng(dataUrl: string): Promise<string | null> {
  if (!dataUrl.startsWith("data:image/svg+xml")) {
    return /^data:image\/(png|jpe?g|webp|gif);base64,/.test(dataUrl) && dataUrl.length <= MAX_INLINE_IMAGE_CHARS
      ? dataUrl
      : null;
  }

  const base64Match = dataUrl.match(/^data:image\/svg\+xml;base64,(.+)$/);
  if (!base64Match) return null;
  // Base64 decodes to ~3/4 of its length; reject before allocating.
  if (base64Match[1].length > Math.ceil((MAX_SVG_BYTES * 4) / 3) + 4) return null;

  try {
    const svgBuffer = Buffer.from(base64Match[1], "base64");
    if (svgBuffer.length > MAX_SVG_BYTES) return null;
    const pngBuffer = await withSlot(() =>
      sharp(svgBuffer, { limitInputPixels: MAX_SVG_INPUT_PIXELS })
        .resize({ width: MAX_RASTER_EDGE, height: MAX_RASTER_EDGE, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer(),
    );
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch (err) {
    log.error("SVG to PNG conversion failed:", err);
    return null;
  }
}
