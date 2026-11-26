"use client";

import type { Recommendation } from "@/lib/report-data";
import { scoreColor } from "@/lib/report-data";
import { cn } from "@/lib/utils";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { CheckCircle2, ChevronDown, CircleHelp, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Fade + slide in once when scrolled into view (static when reduced motion). */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/** Number that counts up when visible. */
export function CountUp({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toFixed(decimals));
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 1.1, ease: "easeOut" });
    return () => c.stop();
  }, [inView, reduce, value, mv]);
  return <motion.span ref={ref} className={className}>{text}</motion.span>;
}

/** Radial gauge (0–10) whose arc draws in on view. */
export function ScoreGauge({ score, size = 148 }: { score: number; size?: number }) {
  const reduce = useReducedMotion();
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / 10));
  const color = scoreColor(score);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="9" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - pct) : c }}
          whileInView={{ strokeDashoffset: c * (1 - pct) }}
          viewport={{ once: true }}
          transition={{ duration: reduce ? 0 : 1.2, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp value={score} decimals={1} className="text-4xl font-bold tabular-nums" />
        <span className="text-xs text-muted-foreground">out of 10</span>
      </div>
    </div>
  );
}

/** Horizontal bar that grows on view; colour-coded by score. */
export function ScoreBar({ label, score, hint }: { label: string; score: number; hint?: string }) {
  const reduce = useReducedMotion();
  const color = scoreColor(score);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-semibold tabular-nums" style={{ color }}>
          {score}/10
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: reduce ? `${score * 10}%` : 0 }}
          whileInView={{ width: `${score * 10}%` }}
          viewport={{ once: true }}
          transition={{ duration: reduce ? 0 : 0.9, ease: "easeOut" }}
        />
      </div>
      {hint && <ExpandableText text={hint} className="text-xs text-muted-foreground" lines={2} />}
    </div>
  );
}

const REC: Record<Recommendation, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  hire: { label: "Recommended: Hire", cls: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800", Icon: CheckCircle2 },
  maybe: { label: "Maybe — review further", cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800", Icon: CircleHelp },
  no: { label: "Not recommended", cls: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800", Icon: XCircle },
};

export function RecommendationBadge({ value }: { value: Recommendation }) {
  const { label, cls, Icon } = REC[value];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold", cls)}>
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
}

export function StatTile({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: "default" | "warn" | "danger";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-sm",
        tone === "warn" && "border-amber-300 dark:border-amber-800",
        tone === "danger" && "border-red-300 dark:border-red-800",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
          tone === "warn" && "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
          tone === "danger" && "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight tabular-nums">{value}</p>
      </div>
    </div>
  );
}

/** Clamp long text with a "Read more" toggle. */
export function ExpandableText({
  text,
  lines = 3,
  className,
}: {
  text: string;
  lines?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 110;
  return (
    <div className={className}>
      <p
        className="whitespace-pre-line leading-relaxed"
        style={
          !open && long
            ? { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }
            : undefined
        }
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
        >
          {open ? "Show less" : "Read more"}
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

export function ScoreChip({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <span
      className="inline-flex min-w-[3.25rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
      style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}55` }}
    >
      {score}/10
    </span>
  );
}
