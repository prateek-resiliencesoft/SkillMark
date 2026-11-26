"use client";

import { Badge } from "@/components/ui/badge";
import { TASK_STATUS_LABELS, type BoardKind, type TaskAnswer, type TaskStatus, type TaskSummary } from "@/lib/round-two/boards";
import { cn } from "@/lib/utils";
import { Code2, PenLine } from "lucide-react";

const STATUS_CLASS: Record<TaskStatus, string> = {
  sent: "border-blue-600 text-blue-700 dark:text-blue-400",
  working: "border-amber-600 text-amber-700 dark:text-amber-400",
  submitted: "border-green-600 text-green-700 dark:text-green-400",
  ended: "border-muted-foreground/40 text-muted-foreground",
};

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("w-fit shrink-0 font-normal", STATUS_CLASS[status], className)}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function KindIcon({ kind, className }: { kind: BoardKind; className?: string }) {
  return kind === "whiteboard" ? <PenLine className={cn("h-3.5 w-3.5", className)} /> : <Code2 className={cn("h-3.5 w-3.5", className)} />;
}

/** Tasks given so far, newest first, with their status. */
export function TaskHistory({ items, activeId, className }: { items: TaskSummary[]; activeId?: string | null; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("space-y-1 text-xs", className)}>
      {[...items].reverse().map((t) => (
        <li key={t.id} className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5", t.id === activeId && "border-primary/50 bg-primary/5")}>
          <KindIcon kind={t.kind} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{t.title}</span>
          <TaskStatusBadge status={t.status} />
        </li>
      ))}
    </ul>
  );
}

/** The candidate's answers, one card per task (code, run output, or the drawing). */
export function TaskAnswers({ items, className }: { items: TaskAnswer[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={cn("space-y-3", className)}>
      {items.map((t) => (
        <div key={t.id} className="rounded-lg border p-3 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <KindIcon kind={t.kind} className="text-muted-foreground" />
            <span className="font-medium">{t.title}</span>
            {t.kind === "coding" && <span className="rounded border px-1.5 text-xs text-muted-foreground">{t.language}</span>}
            <TaskStatusBadge status={t.status} className="ml-auto" />
          </div>
          <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground">{t.prompt}</p>
          {t.kind === "coding" ? (
            t.code ? (
              <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">{t.code}</pre>
            ) : (
              <p className="text-xs text-muted-foreground">No code written.</p>
            )
          ) : t.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.preview} alt={`Drawing: ${t.title}`} className="max-h-80 w-full rounded border bg-white object-contain" />
          ) : (
            <p className="text-xs text-muted-foreground">{t.status === "submitted" ? "Drawing submitted (no preview)." : "No drawing submitted."}</p>
          )}
          {t.runOutput && (
            <pre className="mt-2 max-h-32 overflow-auto rounded border p-2 text-xs">
              {[t.runOutput.stdout, t.runOutput.stderr && `stderr: ${t.runOutput.stderr}`].filter(Boolean).join("\n")}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
