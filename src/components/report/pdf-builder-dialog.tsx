"use client";

import { MM_TO_PX, ReportDocument } from "@/components/report/report-document";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { ReportData } from "@/lib/report-data";
import { renderReportPdf } from "@/lib/report-pdf";
import {
  DEFAULT_REPORT_TEMPLATE,
  MAX_LOGO_DATA_URL_LENGTH,
  moveSection,
  normalizeReportTemplate,
  pageSizeMm,
  REPORT_SECTION_LABELS,
  reportTemplateSchema,
  type ReportTemplate,
} from "@/lib/report-template";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  FileDown,
  GripVertical,
  ImagePlus,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Downscale an uploaded logo to ≤ 360px (PNG) so it fits the template size cap. */
async function fileToLogoDataUrl(file: File): Promise<string> {
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml") return src;
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Not a valid image"));
    i.src = src;
  });
  const k = Math.min(1, 360 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function PdfBuilderDialog({
  open,
  onOpenChange,
  data,
  organizationId,
  sessionId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: ReportData;
  organizationId: string | null | undefined;
  sessionId: string;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const saved = trpc.organization.getReportTemplate.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: open && !!organizationId, staleTime: 60_000 },
  );
  const errorLog = trpc.session.getErrorLog.useQuery({ sessionId }, { enabled: open, retry: false });
  const save = trpc.organization.saveReportTemplate.useMutation({
    onSuccess: () => {
      toast({ title: "Saved as organization default" });
      void utils.organization.getReportTemplate.invalidate();
    },
    onError: (e) => toast({ title: "Could not save template", description: e.message, variant: "destructive" }),
  });

  const [tpl, setTpl] = useState<ReportTemplate>(DEFAULT_REPORT_TEMPLATE);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(520);

  // Start each download from the org default; edits are per-download overrides until saved.
  useEffect(() => {
    if (open && saved.data) {
      setTpl(normalizeReportTemplate(saved.data));
      setDirty(false);
    }
  }, [open, saved.data]);

  useEffect(() => {
    if (!open) return;
    const el = previewBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const page = pageSizeMm(tpl.format);
  const docWidthPx = Math.round((page.width - 20) * MM_TO_PX);
  const previewScale = Math.min(1, (boxW - 24) / docWidthPx);
  const validation = useMemo(() => reportTemplateSchema.safeParse(tpl), [tpl]);

  const update = (fn: (t: ReportTemplate) => ReportTemplate) => {
    setTpl((t) => fn(t));
    setDirty(true);
  };
  const setBranding = (k: keyof ReportTemplate["branding"], v: string | null) =>
    update((t) => ({ ...t, branding: { ...t.branding, [k]: v } }));
  const setFormat = <K extends keyof ReportTemplate["format"]>(k: K, v: ReportTemplate["format"][K]) =>
    update((t) => ({ ...t, format: { ...t.format, [k]: v } }));

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await fileToLogoDataUrl(file);
      if (url.length > MAX_LOGO_DATA_URL_LENGTH) throw new Error("Logo is too large — use an image under ~200 KB");
      setBranding("logoDataUrl", url);
    } catch (e) {
      toast({ title: "Logo not added", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const download = async () => {
    if (!captureRef.current) return;
    setBusy("Rendering…");
    try {
      const blob = await renderReportPdf(captureRef.current, tpl, (_p, label) => setBusy(label));
      const name = `${data.title}_${data.participantName}_report.pdf`.replace(/[^\w.-]+/g, "_");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error("PDF export failed:", e);
      toast({ title: "PDF export failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const doc = (
    <ReportDocument data={data} template={tpl} widthPx={docWidthPx} errorLog={errorLog.data ?? null} />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-w-6xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Customize PDF</DialogTitle>
          <DialogDescription>
            Changes apply to this download. Save them as your organization&apos;s default template to reuse them.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 md:grid-cols-[340px_1fr]">
          {/* Settings */}
          <div className="min-h-0 space-y-6 overflow-y-auto border-r p-5">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Branding</h3>
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-24 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                  {tpl.branding.logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tpl.branding.logoDataUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                    Upload logo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={(e) => void onLogo(e.target.files?.[0])}
                    />
                  </label>
                  {tpl.branding.logoDataUrl && (
                    <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => setBranding("logoDataUrl", null)}>
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  )}
                </div>
              </div>
              <Field label="Header text">
                <Input value={tpl.branding.headerText} maxLength={120} placeholder={`${data.title} — Session report`} onChange={(e) => setBranding("headerText", e.target.value)} />
              </Field>
              <Field label="Subheader">
                <Input value={tpl.branding.subheaderText} maxLength={200} placeholder="e.g. Engineering hiring · Confidential" onChange={(e) => setBranding("subheaderText", e.target.value)} />
              </Field>
              <Field label="Footer text">
                <Input value={tpl.branding.footerText} maxLength={200} onChange={(e) => setBranding("footerText", e.target.value)} />
              </Field>
              <Field label="Accent colour">
                <div className="flex items-center gap-2">
                  <input type="color" value={tpl.branding.accentColor} onChange={(e) => setBranding("accentColor", e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-transparent" aria-label="Accent colour" />
                  <Input value={tpl.branding.accentColor} onChange={(e) => setBranding("accentColor", e.target.value)} className="font-mono" maxLength={7} />
                </div>
              </Field>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Sections</h3>
              <p className="text-xs text-muted-foreground">Toggle sections and drag (or use the arrows) to reorder.</p>
              <ul className="space-y-1.5">
                {tpl.sections.map((s, i) => (
                  <li
                    key={s.id}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIdx !== null && dragIdx !== i) update((t) => ({ ...t, sections: moveSection(t.sections, dragIdx, i - dragIdx) }));
                      setDragIdx(null);
                    }}
                    onDragEnd={() => setDragIdx(null)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm transition-opacity",
                      dragIdx === i && "opacity-50",
                      !s.enabled && "text-muted-foreground",
                    )}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                    <span className="flex-1 truncate">{REPORT_SECTION_LABELS[s.id]}</span>
                    <button type="button" aria-label="Move up" disabled={i === 0} className="rounded p-0.5 hover:bg-muted disabled:opacity-30" onClick={() => update((t) => ({ ...t, sections: moveSection(t.sections, i, -1) }))}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label="Move down" disabled={i === tpl.sections.length - 1} className="rounded p-0.5 hover:bg-muted disabled:opacity-30" onClick={() => update((t) => ({ ...t, sections: moveSection(t.sections, i, 1) }))}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <Switch
                      checked={s.enabled}
                      aria-label={`Include ${REPORT_SECTION_LABELS[s.id]}`}
                      onCheckedChange={(v) => update((t) => ({ ...t, sections: t.sections.map((x, j) => (j === i ? { ...x, enabled: v } : x)) }))}
                    />
                  </li>
                ))}
              </ul>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <h3 className="col-span-2 text-sm font-semibold">Format</h3>
              <Field label="Page size">
                <Select value={tpl.format.pageSize} onValueChange={(v) => setFormat("pageSize", v as "a4" | "letter")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a4">A4</SelectItem>
                    <SelectItem value="letter">Letter</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Orientation">
                <Select value={tpl.format.orientation} onValueChange={(v) => setFormat("orientation", v as "portrait" | "landscape")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Template style">
                <Select value={tpl.format.style} onValueChange={(v) => setFormat("style", v as ReportTemplate["format"]["style"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="classic">Classic</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={`Font size · ${tpl.format.fontSize}px`}>
                <input type="range" min={9} max={16} step={1} value={tpl.format.fontSize} onChange={(e) => setFormat("fontSize", Number(e.target.value))} className="w-full accent-primary" />
              </Field>
            </section>

            {!validation.success && (
              <p className="text-xs text-destructive">{validation.error.issues[0]?.message}</p>
            )}
          </div>

          {/* Live preview */}
          <div ref={previewBox} className="min-h-0 overflow-y-auto bg-muted/40 p-3">
            <div className="mx-auto origin-top shadow-lg" style={{ width: docWidthPx * previewScale }}>
              <div style={{ width: docWidthPx, transform: `scale(${previewScale})`, transformOrigin: "top left" }}>{doc}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => { setTpl(normalizeReportTemplate(saved.data)); setDirty(false); }} disabled={!dirty}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to org default
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!organizationId || !validation.success || save.isLoading}
              onClick={() => organizationId && save.mutate({ organizationId, template: tpl })}
            >
              {save.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save as org default
            </Button>
            <Button disabled={!!busy || !validation.success} onClick={() => void download()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
              {busy ?? "Download PDF"}
            </Button>
          </div>
        </div>

        {/* Unscaled off-screen copy used for capture (transforms would distort html2canvas). */}
        {open && (
          <div aria-hidden style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}>
            <ReportDocument ref={captureRef} data={data} template={tpl} widthPx={docWidthPx} errorLog={errorLog.data ?? null} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
