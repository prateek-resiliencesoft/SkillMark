"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

type CvDoc =
  | { kind: "pdf"; pdf: PDFDocumentProxy; blob: Blob }
  | { kind: "image"; objectUrl: string; blob: Blob }
  | { kind: "text"; text: string; blob: Blob }
  | { kind: "other"; blob: Blob };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; fallbackUrl: string | null }
  | { status: "ready"; doc: CvDoc };

const EXT: Record<CvDoc["kind"], string> = { pdf: ".pdf", image: "", text: ".txt", other: "" };

function downloadName(name: string, kind: CvDoc["kind"]): string {
  const base = (name || "resume").trim() || "resume";
  return /\.[A-Za-z0-9]{2,5}$/.test(base) ? base : `${base}${EXT[kind]}`;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Resolves the candidate's resume (signed URL → bytes) and prepares it for in-page viewing. */
function useCvDocument(candidateId: string) {
  const access = trpc.candidate.resumeAccess.useQuery(
    { candidateId },
    { retry: false, refetchOnWindowFocus: false, staleTime: 30 * 60 * 1000 },
  );
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const data = access.data;
  const accessError = access.error?.message ?? null;
  const accessLoading = access.isLoading;

  useEffect(() => {
    if (accessLoading) {
      setState({ status: "loading" });
      return;
    }
    if (!data) {
      setState({
        status: "error",
        message: accessError ?? "No resume on file for this candidate.",
        fallbackUrl: null,
      });
      return;
    }

    const controller = new AbortController();
    const objectUrls: string[] = [];
    let pdf: PDFDocumentProxy | null = null;
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        if (!data.url) {
          const text = data.markdown ?? "";
          const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
          if (!cancelled) setState({ status: "ready", doc: { kind: "text", text, blob } });
          return;
        }

        const res = await fetch(data.url, { signal: controller.signal, credentials: "same-origin" });
        if (!res.ok) throw new Error(`The file could not be loaded (HTTP ${res.status}).`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;

        const name = (data.name || "").toLowerCase();
        const type = (data.type || "").toLowerCase();
        const isPdf = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(5, buf.byteLength))) === "%PDF-";

        if (isPdf) {
          const blob = new Blob([buf], { type: "application/pdf" });
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.js",
            import.meta.url,
          ).toString();
          // pdf.js takes ownership of the bytes it is given; keep `blob` for download.
          const loaded = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
          if (cancelled) {
            void loaded.destroy();
            return;
          }
          pdf = loaded;
          setState({ status: "ready", doc: { kind: "pdf", pdf: loaded, blob } });
        } else if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/.test(name)) {
          const blob = new Blob([buf], { type: type.startsWith("image/") ? type : "image/png" });
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          setState({ status: "ready", doc: { kind: "image", objectUrl, blob } });
        } else if (type.startsWith("text/") || /\.(txt|md)$/.test(name)) {
          const text = new TextDecoder().decode(buf);
          setState({
            status: "ready",
            doc: { kind: "text", text, blob: new Blob([buf], { type: "text/plain;charset=utf-8" }) },
          });
        } else {
          setState({
            status: "ready",
            doc: { kind: "other", blob: new Blob([buf], { type: type || "application/octet-stream" }) },
          });
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not open the resume.",
          fallbackUrl: data.url ?? null,
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
      if (pdf) void pdf.destroy();
    };
  }, [data, accessError, accessLoading]);

  return { state, name: data?.name ?? "" };
}

function PdfPage({
  pdf,
  pageNumber,
  zoom,
  rotation,
  containerWidth,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  rotation: number;
  containerWidth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRender = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (containerWidth <= 0) return;
    let cancelled = false;
    let task: RenderTask | null = null;

    (async () => {
      try {
        // A canvas can only host one render at a time: let the cancelled one settle first.
        await lastRender.current;
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const rot = (page.rotate + rotation) % 360;
        const base = page.getViewport({ scale: 1, rotation: rot });
        const scale = (Math.max(120, containerWidth - 24) / base.width) * zoom;
        const viewport = page.getViewport({ scale, rotation: rot });
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        task = page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        lastRender.current = task.promise.catch(() => undefined);
        await task.promise;
      } catch (err) {
        if ((err as { name?: string })?.name !== "RenderingCancelledException") {
          console.error("CV page render failed", err);
        }
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, zoom, rotation, containerWidth]);

  return (
    <div data-page={pageNumber} className="mx-auto mb-3 w-fit bg-white shadow-sm ring-1 ring-border">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

export function CvViewerPanel({
  candidateId,
  candidateName,
  onClose,
}: {
  candidateId: string;
  candidateName?: string | null;
  onClose: () => void;
}) {
  const { state, name } = useCvDocument(candidateId);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const doc = state.status === "ready" ? state.doc : null;
  const numPages = doc?.kind === "pdf" ? doc.pdf.numPages : 1;

  // Fit-to-width follows the panel as it is resized.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [state.status]);

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms the CV instead of the whole page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.003));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [state.status]);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z - ZOOM_STEP)), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomIn();
    } else if (e.key === "-") {
      e.preventDefault();
      zoomOut();
    } else if (e.key === "0") {
      e.preventDefault();
      resetZoom();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || doc?.kind !== "pdf") return;
    const pages = Array.from(el.querySelectorAll<HTMLElement>("[data-page]"));
    let current = 1;
    for (const p of pages) {
      if (p.offsetTop - el.scrollTop <= el.clientHeight * 0.35) current = Number(p.dataset.page);
    }
    setPage(current);
  };

  const goToPage = (n: number) => {
    const el = scrollRef.current;
    const target = el?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (el && target) el.scrollTo({ top: target.offsetTop - 8, behavior: "smooth" });
  };

  const fileName = doc ? downloadName(name, doc.kind) : "";
  const download = () => {
    if (doc) saveBlob(doc.blob, fileName);
  };
  const openInTab = () => {
    if (doc && doc.kind !== "other") {
      const url = URL.createObjectURL(doc.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else if (state.status === "error" && state.fallbackUrl) {
      window.open(state.fallbackUrl, "_blank", "noopener,noreferrer");
    }
  };

  const canView = !!doc && doc.kind !== "other";
  const iconBtn = "h-8 w-8";

  return (
    <div className="flex h-full min-h-0 flex-col outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            {candidateName ? `${candidateName}'s CV` : "Candidate CV"}
          </p>
          {name && (
            <p className="truncate text-xs text-muted-foreground" title={name}>
              {name}
            </p>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" className={iconBtn} onClick={onClose} aria-label="Close CV">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={iconBtn}
          onClick={zoomOut}
          disabled={!canView || zoom <= MIN_ZOOM}
          title="Zoom out (-)"
          aria-label="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <button
          type="button"
          onClick={resetZoom}
          disabled={!canView}
          title="Reset zoom to fit width (0)"
          className="h-8 min-w-[3.25rem] rounded-md px-1.5 text-xs font-medium tabular-nums hover:bg-accent disabled:opacity-50"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={iconBtn}
          onClick={zoomIn}
          disabled={!canView || zoom >= MAX_ZOOM}
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={iconBtn}
          onClick={resetZoom}
          disabled={!canView}
          title="Fit to width"
          aria-label="Fit to width"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        {doc?.kind === "pdf" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconBtn}
            onClick={() => setRotation((r) => (r + 90) % 360)}
            title="Rotate"
            aria-label="Rotate"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        )}

        {doc?.kind === "pdf" && numPages > 1 && (
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={iconBtn}
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              title="Previous page"
              aria-label="Previous page"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <span className="min-w-[2.5rem] text-center text-xs tabular-nums text-muted-foreground">
              {page}/{numPages}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={iconBtn}
              onClick={() => goToPage(Math.min(numPages, page + 1))}
              disabled={page >= numPages}
              title="Next page"
              aria-label="Next page"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconBtn}
            onClick={openInTab}
            disabled={!canView && !(state.status === "error" && state.fallbackUrl)}
            title="Open in new tab"
            aria-label="Open in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={iconBtn}
            onClick={download}
            disabled={!doc}
            title="Download"
            aria-label="Download CV"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto bg-muted/40">
        {state.status === "loading" && (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-[60vh] w-full" />
          </div>
        )}

        {state.status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{state.message}</p>
            {state.fallbackUrl && (
              <Button type="button" size="sm" variant="outline" onClick={openInTab}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open original
              </Button>
            )}
          </div>
        )}

        {doc?.kind === "pdf" && (
          <div className="p-3">
            {Array.from({ length: doc.pdf.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                pdf={doc.pdf}
                pageNumber={i + 1}
                zoom={zoom}
                rotation={rotation}
                containerWidth={width}
              />
            ))}
          </div>
        )}

        {doc?.kind === "image" && (
          <div className="p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={doc.objectUrl}
              alt={name || "Candidate CV"}
              className="mx-auto block max-w-none bg-white shadow-sm ring-1 ring-border"
              style={{ width: `${zoom * 100}%` }}
            />
          </div>
        )}

        {doc?.kind === "text" && (
          <pre
            className={cn("whitespace-pre-wrap break-words p-4 font-sans leading-relaxed")}
            style={{ fontSize: `${13 * zoom}px` }}
          >
            {doc.text}
          </pre>
        )}

        {doc?.kind === "other" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              This file type can&apos;t be previewed here. Download it to read it.
            </p>
            <Button type="button" size="sm" onClick={download}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
