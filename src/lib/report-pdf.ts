import { computePageBreaks, pageSizeMm, type ReportTemplate } from "@/lib/report-template";

const MARGIN_MM = 10;
const FOOTER_MM = 8;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Render a ReportDocument element to a paginated PDF (html2canvas-pro + jsPDF,
 * same approach as the original export) with block-aware page breaks and a
 * branded footer + page numbers on every page.
 */
/**
 * Browsers silently return an empty (black / transparent) canvas when it is
 * too large (Safari ~16.7MP, Chrome memory limits on long reports). Keep the
 * capture under these limits and verify the result before building a PDF.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;
export const MAX_CANVAS_SIDE = 16_384;
const MIN_SCALE = 0.5;

/** Largest scale ≤ preferred that keeps a w×h CSS-px element inside the canvas limits. */
export function pickCaptureScale(widthPx: number, heightPx: number, preferred = 2): number {
  if (widthPx <= 0 || heightPx <= 0) return preferred;
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (widthPx * heightPx));
  const bySide = MAX_CANVAS_SIDE / Math.max(widthPx, heightPx);
  return Math.max(MIN_SCALE, Math.min(preferred, byArea, bySide));
}

/** Pixel data sampled on a small grid; true when every sample is the same colour. */
export function isUniformSample(rgba: Uint8ClampedArray): boolean {
  if (rgba.length < 8) return true;
  const [r, g, b, a] = [rgba[0], rgba[1], rgba[2], rgba[3]];
  for (let i = 4; i < rgba.length; i += 4) {
    if (
      Math.abs(rgba[i] - r) > 6 ||
      Math.abs(rgba[i + 1] - g) > 6 ||
      Math.abs(rgba[i + 2] - b) > 6 ||
      Math.abs(rgba[i + 3] - a) > 6
    ) {
      return false;
    }
  }
  return true;
}

/** A rendered report always has text on a white background — a single flat colour means the render failed. */
export function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  if (!canvas.width || !canvas.height) return true;
  const probe = document.createElement("canvas");
  probe.width = 48;
  probe.height = 48;
  const ctx = probe.getContext("2d");
  if (!ctx) return false;
  try {
    ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    return isUniformSample(ctx.getImageData(0, 0, probe.width, probe.height).data);
  } catch {
    return false; // tainted canvas: can't check, assume fine
  }
}

/** html2canvas with a size-safe scale; retries smaller when the output comes back blank. */
export async function captureElementForPdf(
  el: HTMLElement,
  preferredScale = 2,
): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas-pro")).default;
  const rect = el.getBoundingClientRect();
  let scale = pickCaptureScale(rect.width, Math.max(rect.height, el.scrollHeight), preferredScale);
  for (let attempt = 0; attempt < 3; attempt++) {
    const canvas = await html2canvas(el, {
      scale,
      useCORS: true,
      backgroundColor: "#ffffff",
      imageTimeout: 60000,
      logging: false,
    });
    if (!isCanvasBlank(canvas)) return canvas;
    canvas.width = 0; // free memory before retrying
    canvas.height = 0;
    if (scale <= MIN_SCALE) break;
    scale = Math.max(MIN_SCALE, scale * 0.6);
  }
  throw new Error("The report could not be rendered (blank page). Try collapsing the transcript and export again.");
}

/** Page slices (canvas px) that prefer breaking at [data-pdf-block] edges. */
export function pageSlicesForCanvas(
  el: HTMLElement,
  canvas: HTMLCanvasElement,
  pageHeightPx: number,
): [number, number][] {
  const top = el.getBoundingClientRect().top;
  const ratio = canvas.width / el.getBoundingClientRect().width;
  const boundaries = Array.from(el.querySelectorAll<HTMLElement>("[data-pdf-block]")).flatMap((b) => {
    const r = b.getBoundingClientRect();
    return [(r.top - top) * ratio, (r.bottom - top) * ratio];
  });
  return computePageBreaks(canvas.height, pageHeightPx, boundaries);
}

/** Copy one vertical slice of the big canvas into a page-sized JPEG. */
export function sliceToJpeg(canvas: HTMLCanvasElement, start: number, end: number): { data: string; height: number } {
  const h = Math.max(1, Math.ceil(end - start));
  const part = document.createElement("canvas");
  part.width = canvas.width;
  part.height = h;
  const ctx = part.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, part.width, h);
  ctx.drawImage(canvas, 0, start, canvas.width, h, 0, 0, canvas.width, h);
  const data = part.toDataURL("image/jpeg", 0.92);
  part.width = 0;
  part.height = 0;
  return { data, height: h };
}

export async function renderReportPdf(
  el: HTMLElement,
  template: ReportTemplate,
  onProgress?: (pct: number, label: string) => void,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  onProgress?.(10, "Rendering…");

  const canvas = await captureElementForPdf(el, 2);
  onProgress?.(60, "Paginating…");

  const page = pageSizeMm(template.format);
  const contentW = page.width - MARGIN_MM * 2;
  const contentH = page.height - MARGIN_MM * 2 - FOOTER_MM;
  const pxPerMm = canvas.width / contentW;
  const pageHeightPx = contentH * pxPerMm;

  const slices = pageSlicesForCanvas(el, canvas, pageHeightPx);

  const pdf = new jsPDF({
    orientation: template.format.orientation === "landscape" ? "l" : "p",
    unit: "mm",
    format: template.format.pageSize,
  });
  const [r, g, b] = hexToRgb(template.branding.accentColor);

  slices.forEach(([start, end], i) => {
    if (i > 0) pdf.addPage();
    const { data, height: h } = sliceToJpeg(canvas, start, end);
    pdf.addImage(data, "JPEG", MARGIN_MM, MARGIN_MM, contentW, h / pxPerMm);

    const fy = page.height - MARGIN_MM + 2;
    pdf.setDrawColor(r, g, b);
    pdf.setLineWidth(0.4);
    pdf.line(MARGIN_MM, fy - 5, page.width - MARGIN_MM, fy - 5);
    pdf.setFontSize(8);
    pdf.setTextColor(107, 114, 128);
    if (template.branding.footerText) pdf.text(template.branding.footerText.slice(0, 160), MARGIN_MM, fy);
    pdf.text(`Page ${i + 1} of ${slices.length}`, page.width - MARGIN_MM, fy, { align: "right" });
  });
  canvas.width = 0;
  canvas.height = 0;
  onProgress?.(95, "Saving…");
  return pdf.output("blob");
}
