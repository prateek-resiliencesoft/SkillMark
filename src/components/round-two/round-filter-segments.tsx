"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RoundFilterValue } from "@/lib/round-two/round-filter";

export function RoundFilterSegments({
  value,
  maxRound,
  onChange,
  className,
}: {
  value: RoundFilterValue;
  maxRound: number;
  onChange: (next: RoundFilterValue) => void;
  className?: string;
}) {
  const rounds = Array.from({ length: Math.max(1, maxRound) }, (_, i) => i + 1);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center rounded-xl border border-border/60 bg-muted/60 p-1",
        className,
      )}
      role="group"
      aria-label="Filter by round"
    >
      <SegmentButton active={value === "ALL"} onClick={() => onChange("ALL")}>
        All
      </SegmentButton>
      {rounds.map((n) => (
        <SegmentButton
          key={n}
          active={value === n}
          onClick={() => onChange(n)}
        >
          Round {n}
        </SegmentButton>
      ))}
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 sm:text-sm",
        active
          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
