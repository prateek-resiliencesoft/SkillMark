"use client";

import { cn } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    setDesktop(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setDesktop(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Main content with an optional resizable side panel.
 *
 * Desktop (lg+): content and panel sit side by side; drag the divider (or focus it and use
 * ←/→, Home/End; double-click resets) to resize. The panel width is a percentage of the
 * container and is remembered in localStorage under `storageKey`.
 * Smaller screens: the panel opens as a full-screen overlay instead.
 *
 * `children` stay mounted in the same place whether the panel is open or not, so opening the
 * panel never resets the content's state.
 */
export function ResizableSplit({
  open,
  panel,
  children,
  defaultPanelPct = 25,
  minPanelPct = 18,
  maxPanelPct = 60,
  storageKey,
  className,
}: {
  open: boolean;
  panel: ReactNode;
  children: ReactNode;
  /** Panel width as a percentage of the whole container (default 25 → 75/25 split). */
  defaultPanelPct?: number;
  minPanelPct?: number;
  maxPanelPct?: number;
  storageKey?: string;
  className?: string;
}) {
  const isDesktop = useIsDesktop();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(defaultPanelPct);
  const [dragging, setDragging] = useState(false);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const pctRef = useRef(pct);
  pctRef.current = pct;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) setPct(clamp(saved, minPanelPct, maxPanelPct));
    } catch {
      /* storage unavailable */
    }
  }, [storageKey, minPanelPct, maxPanelPct]);

  const persist = useCallback(
    (value: number) => {
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, String(Math.round(value * 10) / 10));
      } catch {
        /* storage unavailable */
      }
    },
    [storageKey],
  );

  // The dashboard scrolls inside <main>; keep the docked panel as tall as that viewport.
  useEffect(() => {
    if (!open || !isDesktop) return;
    const scroller = containerRef.current?.closest("main") ?? null;
    const measure = () => {
      const h = scroller ? scroller.clientHeight : window.innerHeight;
      setPanelHeight(Math.max(320, h - 16));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = scroller && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (scroller) ro?.observe(scroller);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [open, isDesktop]);

  const updateFromPointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    setPct(clamp(((rect.right - clientX) / rect.width) * 100, minPanelPct, maxPanelPct));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) updateFromPointer(e.clientX);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    persist(pctRef.current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    const step = e.shiftKey ? 5 : 2;
    if (e.key === "ArrowLeft") next = pct + step;
    else if (e.key === "ArrowRight") next = pct - step;
    else if (e.key === "Home") next = maxPanelPct;
    else if (e.key === "End") next = minPanelPct;
    else if (e.key === "Enter") next = defaultPanelPct;
    if (next === null) return;
    e.preventDefault();
    const v = clamp(next, minPanelPct, maxPanelPct);
    setPct(v);
    persist(v);
  };

  const docked = open && isDesktop;
  const overlay = open && !isDesktop;

  return (
    <div
      ref={containerRef}
      className={cn("relative", docked && "flex items-start", dragging && "select-none", className)}
    >
      <div className="min-w-0 flex-1">{children}</div>

      {docked && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuemin={minPanelPct}
            aria-valuemax={maxPanelPct}
            aria-valuenow={Math.round(pct)}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            onDoubleClick={() => {
              setPct(defaultPanelPct);
              persist(defaultPanelPct);
            }}
            className="no-print group relative z-10 w-3 shrink-0 cursor-col-resize touch-none self-stretch outline-none"
          >
            <div
              className={cn(
                "sticky top-[40vh] mx-auto h-16 w-1 rounded-full bg-border transition-colors",
                "group-hover:bg-primary/60 group-focus-visible:bg-primary",
                dragging && "bg-primary",
              )}
            />
          </div>
          <aside
            className="no-print sticky top-2 shrink-0 self-start overflow-hidden rounded-xl border bg-card shadow-sm"
            style={{ width: `${pct}%`, height: panelHeight ?? undefined }}
          >
            {panel}
          </aside>
          {/* While dragging, keep iframes/canvases from swallowing pointer events. */}
          {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
        </>
      )}

      {overlay &&
        createPortal(
          <aside className="no-print fixed inset-0 z-50 flex flex-col bg-background">{panel}</aside>,
          document.body,
        )}
    </div>
  );
}
