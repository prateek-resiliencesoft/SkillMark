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
export async function renderReportPdf(
  el: HTMLElement,
  template: ReportTemplate,
  onProgress?: (pct: number, label: string) => void,
): Promise<Blob> {
  const html2canvas = (await import("html2canvas-pro")).default;
  const { jsPDF } = await import("jspdf");
  onProgress?.(10, "Rendering…");

  const scale = 2;
  const canvas = await html2canvas(el, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    imageTimeout: 60000,
    logging: false,
  });
  onProgress?.(60, "Paginating…");

  const page = pageSizeMm(template.format);
  const contentW = page.width - MARGIN_MM * 2;
  const contentH = page.height - MARGIN_MM * 2 - FOOTER_MM;
  const pxPerMm = canvas.width / contentW;
  const pageHeightPx = contentH * pxPerMm;

  const top = el.getBoundingClientRect().top;
  const ratio = canvas.width / el.getBoundingClientRect().width;
  const boundaries = Array.from(el.querySelectorAll<HTMLElement>("[data-pdf-block]")).flatMap((b) => {
    const r = b.getBoundingClientRect();
    return [(r.top - top) * ratio, (r.bottom - top) * ratio];
  });
  const slices = computePageBreaks(canvas.height, pageHeightPx, boundaries);

  const pdf = new jsPDF({
    orientation: template.format.orientation === "landscape" ? "l" : "p",
    unit: "mm",
    format: template.format.pageSize,
  });
  const [r, g, b] = hexToRgb(template.branding.accentColor);

  slices.forEach(([start, end], i) => {
    if (i > 0) pdf.addPage();
    const h = Math.ceil(end - start);
    const part = document.createElement("canvas");
    part.width = canvas.width;
    part.height = h;
    const ctx = part.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, part.width, h);
    ctx.drawImage(canvas, 0, start, canvas.width, h, 0, 0, canvas.width, h);
    pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN_MM, MARGIN_MM, contentW, h / pxPerMm);

    const fy = page.height - MARGIN_MM + 2;
    pdf.setDrawColor(r, g, b);
    pdf.setLineWidth(0.4);
    pdf.line(MARGIN_MM, fy - 5, page.width - MARGIN_MM, fy - 5);
    pdf.setFontSize(8);
    pdf.setTextColor(107, 114, 128);
    if (template.branding.footerText) pdf.text(template.branding.footerText.slice(0, 160), MARGIN_MM, fy);
    pdf.text(`Page ${i + 1} of ${slices.length}`, page.width - MARGIN_MM, fy, { align: "right" });
  });
  onProgress?.(95, "Saving…");
  return pdf.output("blob");
}
