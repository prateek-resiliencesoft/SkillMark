"use client";

import { Badge } from "@/components/ui/badge";
import { RECOMMENDATION_LABELS, type Recommendation } from "@/lib/round-two/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-muted-foreground/40 text-muted-foreground" },
  scheduled: { label: "Scheduled", className: "border-blue-600 text-blue-700 dark:text-blue-400" },
  live: { label: "Live", className: "border-red-600 text-red-700 dark:text-red-400" },
  ended: { label: "Ended", className: "border-green-600 text-green-700 dark:text-green-400" },
  cancelled: { label: "Cancelled", className: "border-muted-foreground/40 text-muted-foreground" },
  no_show: { label: "No-show", className: "border-amber-600 text-amber-700 dark:text-amber-400" },
};

export function RoundTwoStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("w-fit", s.className, className)}>
      {status === "live" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />}
      {s.label}
    </Badge>
  );
}

export function RecommendationBadge({ value }: { value: string | null | undefined }) {
  if (!value || !(value in RECOMMENDATION_LABELS)) return null;
  const positive = value.endsWith("yes");
  return (
    <Badge
      variant="outline"
      className={cn(
        "w-fit",
        positive ? "border-green-600 text-green-700 dark:text-green-400" : "border-red-600 text-red-700 dark:text-red-400",
      )}
    >
      {RECOMMENDATION_LABELS[value as Recommendation]}
    </Badge>
  );
}
