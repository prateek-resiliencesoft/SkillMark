"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_CATEGORIES, type QuestionCategory, type QuestionPlanItem } from "@/lib/round-two/types";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioral: "Behavioral",
  probe_round1: "Round 1 probe",
  cv_claim: "CV claim",
  culture: "Culture",
  other: "Other",
};

export function PlanEditor({
  plan,
  onChange,
  readOnly,
}: {
  plan: QuestionPlanItem[];
  onChange: (next: QuestionPlanItem[]) => void;
  readOnly?: boolean;
}) {
  const update = (i: number, patch: Partial<QuestionPlanItem>) =>
    onChange(plan.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= plan.length) return;
    const next = [...plan];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => {
    let n = plan.length + 1;
    while (plan.some((q) => q.id === `m${n}`)) n++;
    onChange([...plan, { id: `m${n}`, text: "", category: "technical" }]);
  };
  const totalMin = plan.reduce((s, q) => s + (q.minutes ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {plan.length} question{plan.length === 1 ? "" : "s"}
          {totalMin > 0 ? ` · about ${totalMin} min` : ""}
        </span>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add question
          </Button>
        )}
      </div>
      {plan.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No questions yet. Ask the AI to draft a plan, or add your own.
        </p>
      )}
      {plan.map((q, i) => (
        <div key={q.id} className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Q{i + 1}</span>
            {readOnly ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{CATEGORY_LABELS[q.category]}</span>
            ) : (
              <select
                value={q.category}
                onChange={(e) => update(i, { category: e.target.value as QuestionCategory })}
                className="h-7 rounded-md border bg-background px-1.5 text-xs"
              >
                {QUESTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            )}
            {!readOnly && (
              <Input
                type="number"
                min={1}
                max={60}
                value={q.minutes ?? ""}
                placeholder="min"
                onChange={(e) => update(i, { minutes: e.target.value ? Math.max(1, Math.min(60, Number(e.target.value))) : undefined })}
                className="h-7 w-16 text-xs"
              />
            )}
            {!readOnly && (
              <div className="ml-auto flex items-center gap-0.5">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => move(i, 1)}
                  disabled={i === plan.length - 1}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => onChange(plan.filter((_, j) => j !== i))}
                  aria-label="Remove question"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          {readOnly ? (
            <p className="text-sm">{q.text}</p>
          ) : (
            <Textarea
              value={q.text}
              onChange={(e) => update(i, { text: e.target.value })}
              rows={2}
              className="text-sm"
              placeholder="Question text"
            />
          )}
          {q.rationale && <p className="mt-1.5 text-xs text-muted-foreground">Why: {q.rationale}</p>}
          {q.followUps && q.followUps.length > 0 && (
            <ul className={cn("mt-1.5 space-y-0.5 text-xs text-muted-foreground")}>
              {q.followUps.map((f, k) => (
                <li key={k}>↳ {f}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
