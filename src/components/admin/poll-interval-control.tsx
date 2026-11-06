"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useState } from "react";

const PRESETS: { label: string; ms: number | "custom" }[] = [
  { label: "Off", ms: 0 },
  { label: "1s", ms: 1_000 },
  { label: "5s", ms: 5_000 },
  { label: "15s", ms: 15_000 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "Custom", ms: "custom" },
];

function clampSeconds(raw: string) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(3600, Math.max(1, n));
}

/**
 * Single "how often to poll Grafana" control shared by the server pages.
 * Returns the interval in ms (0 = off) plus the control to render.
 */
export function usePollInterval(defaultMs = 5_000) {
  const [preset, setPreset] = useState<number | "custom">(defaultMs);
  const [customSeconds, setCustomSeconds] = useState("10");

  const ms = preset === "custom" ? clampSeconds(customSeconds) * 1000 : preset;

  const control = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Update every</span>
      <div className="flex rounded-md border p-0.5" role="group" aria-label="Polling interval">
        {PRESETS.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => setPreset(r.ms)}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              preset === r.ms ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      {preset === "custom" ? (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            type="number"
            min={1}
            max={3600}
            step={1}
            value={customSeconds}
            onChange={(e) => setCustomSeconds(e.target.value)}
            onBlur={() => setCustomSeconds(String(clampSeconds(customSeconds)))}
            className="h-8 w-20 text-sm"
            aria-label="Custom polling seconds"
          />
          <span>sec (1–3600)</span>
        </label>
      ) : null}
    </div>
  );

  return { ms, control };
}
