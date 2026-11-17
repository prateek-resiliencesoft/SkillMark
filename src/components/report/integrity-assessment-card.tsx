"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IntegrityAssessment, IntegritySignal } from "@/lib/integrity/signals";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";

const CONCERN: Record<IntegrityAssessment["concern"], { label: string; className: string }> = {
  none: { label: "No concerns", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
  low: { label: "Low concern", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  review: { label: "Needs review", className: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300" },
};

const SIGNAL_TEXT: Partial<Record<IntegritySignal["type"], (s: IntegritySignal) => string>> = {
  virtual_camera: (s) => `Virtual camera: ${s.detail}`,
  virtual_microphone: (s) => `Virtual microphone: ${s.detail}`,
  processing_device: (s) => `Processing device: ${s.detail}`,
  device_changed: (s) => s.detail ?? "Device changed",
  av_correlation: (s) => `Voice / lip correlation r=${s.value} (${s.detail ?? ""})`,
  reading_pattern: (s) => `Reading-like eye movement (${s.value} sweeps)`,
  liveness: (s) => `Liveness ${s.value === 1 ? "passed" : "failed"}: ${s.detail ?? ""}`,
  extension_injection: (s) => `Extension in page: ${s.detail}`,
  detector_unavailable: (s) => `Check unavailable: ${s.detail}`,
};

/** Reviewer-only integrity assessment: signals, not proof. */
export function IntegrityAssessmentCard({
  assessment,
  signals,
}: {
  assessment: IntegrityAssessment | null | undefined;
  signals: IntegritySignal[] | null | undefined;
}) {
  if (!assessment) return null;
  const concern = CONCERN[assessment.concern];
  const timeline = (signals ?? []).filter((s) => SIGNAL_TEXT[s.type]).slice(-30);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" /> Integrity checks
          <Badge className={cn("ml-1 border-0", concern.className)}>{concern.label}</Badge>
          <span className="ml-auto text-sm font-normal text-muted-foreground">Score {assessment.score}/100</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          These are signals, not proof. Noise suppression, network lag or accessibility tools can trigger them.
          &quot;Needs review&quot; requires two independent kinds of signal; please check the recording before deciding.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {assessment.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No integrity signals were raised.</p>
        ) : (
          <ul className="space-y-3">
            {assessment.groups.map((g) => (
              <li key={g.group}>
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>{g.label}</span>
                  <span className="text-muted-foreground">{Math.round(g.level * 100)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full", g.level >= 0.5 ? "bg-red-500" : g.level >= 0.3 ? "bg-amber-500" : "bg-emerald-500")}
                    style={{ width: `${Math.round(g.level * 100)}%` }}
                  />
                </div>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {g.reasons.slice(0, 5).map((r) => <li key={r}>{r}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {timeline.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Signal timeline ({timeline.length})</summary>
            <ul className="mt-2 space-y-1">
              {timeline.map((s, i) => (
                <li key={`${s.timestamp}-${i}`} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {new Date(s.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span>{SIGNAL_TEXT[s.type]!(s)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
