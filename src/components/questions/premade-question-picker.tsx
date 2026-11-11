"use client";

import { useOrg } from "@/components/org-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  sectionsMatchingInterviewType,
  toPremadePayload,
  type PremadeBankQuestion,
} from "@/lib/premade-sections";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type { PremadeBankQuestion };

export function PremadeQuestionPicker({
  interviewType,
  includePremade,
  onIncludeChange,
  selectedIds,
  onSelectedChange,
  disabled,
  compact,
}: {
  interviewType?: string;
  includePremade: boolean;
  onIncludeChange: (v: boolean) => void;
  selectedIds: Set<string>;
  onSelectedChange: (ids: Set<string>) => void;
  disabled?: boolean;
  /** Tighter copy for dialogs */
  compact?: boolean;
}) {
  const { currentOrg } = useOrg();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lastSeedKey = useRef<string>("");
  const userTouchedRef = useRef(false);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const bank = trpc.questionBank.getEnabledQuestions.useQuery(
    { organizationId: currentOrg?.id ?? "" },
    {
      enabled: !!currentOrg?.id,
      staleTime: 10_000,
      refetchOnMount: "always",
    },
  );

  const sections = bank.data?.sections ?? [];
  const questions: PremadeBankQuestion[] = bank.data?.questions ?? [];

  const suggestedSections = useMemo(
    () => sectionsMatchingInterviewType(interviewType, sections),
    [interviewType, sections],
  );
  const suggestedSectionIds = useMemo(
    () => new Set(suggestedSections.map((s) => s.id)),
    [suggestedSections],
  );

  // Seed: select ALL bank questions so newly added rounds/Qs show + get included.
  // "Suggested" button still narrows by interview type. Don't wipe after user edits.
  useEffect(() => {
    if (!includePremade || !questions.length || disabled) return;

    const idsKey = questions.map((q) => q.id).join(",");
    const seedKey = `all:${idsKey}`;
    if (lastSeedKey.current === seedKey) return;

    const prevKey = lastSeedKey.current;
    lastSeedKey.current = seedKey;

    // Always expand every round so questions are visible without hunting.
    setExpanded(new Set(sections.map((s) => s.id)));

    if (userTouchedRef.current && prevKey.startsWith("all:")) {
      const prevIds = new Set(prevKey.slice(4).split(",").filter(Boolean));
      const next = new Set(selectedIdsRef.current);
      for (const q of questions) {
        if (!prevIds.has(q.id)) next.add(q.id);
      }
      onSelectedChange(next);
      return;
    }

    userTouchedRef.current = false;
    onSelectedChange(new Set(questions.map((q) => q.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on bank/include only
  }, [includePremade, questions, sections, disabled]);

  const selectedQuestions = useMemo(
    () => questions.filter((q) => selectedIds.has(q.id)),
    [questions, selectedIds],
  );

  const markTouched = (next: Set<string>) => {
    userTouchedRef.current = true;
    onSelectedChange(next);
  };

  const toggleSection = (sectionId: string) => {
    const inSection = questions.filter((q) => q.sectionId === sectionId);
    const allOn = inSection.length > 0 && inSection.every((q) => selectedIds.has(q.id));
    const next = new Set(selectedIds);
    for (const q of inSection) {
      if (allOn) next.delete(q.id);
      else next.add(q.id);
    }
    markTouched(next);
  };

  const toggleQuestion = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    markTouched(next);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {!compact && (
        <Label className="text-sm font-semibold">Premade section questions</Label>
      )}
      <div className="space-y-3 rounded-xl border border-border/80 bg-card/60 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold text-foreground">
              Include standard round questions
            </p>
            <p className="text-xs text-muted-foreground">
              {interviewType
                ? `All enabled Question Bank rounds listed. “Suggested” highlights “${interviewType}” rounds.`
                : "Pull from Question Bank. Expand a round to pick exact questions."}
            </p>
          </div>
          <Switch
            className="mt-0.5 shrink-0"
            checked={includePremade}
            disabled={disabled}
            onCheckedChange={(v) => {
              if (v) userTouchedRef.current = false;
              onIncludeChange(v);
            }}
          />
        </div>

        {includePremade && bank.isLoading && (
          <p className="text-xs text-muted-foreground">Loading question bank…</p>
        )}

        {includePremade && sections.length > 0 && (
          <div className="space-y-2 border-t border-border/50 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {selectedQuestions.length} of {questions.length} selected
              </p>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={disabled}
                  onClick={() => markTouched(new Set(questions.map((q) => q.id)))}
                >
                  All
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={disabled}
                  onClick={() =>
                    markTouched(
                      new Set(
                        questions
                          .filter((q) => suggestedSectionIds.has(q.sectionId))
                          .map((q) => q.id),
                      ),
                    )
                  }
                >
                  Suggested
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={disabled}
                  onClick={() => markTouched(new Set())}
                >
                  None
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              {sections.map((sec) => {
                const inSection = questions.filter((q) => q.sectionId === sec.id);
                const selectedCount = inSection.filter((q) => selectedIds.has(q.id)).length;
                const allOn = inSection.length > 0 && selectedCount === inSection.length;
                const someOn = selectedCount > 0 && !allOn;
                const isSuggested = suggestedSectionIds.has(sec.id);
                const isOpen = expanded.has(sec.id);

                return (
                  <div
                    key={sec.id}
                    className={cn(
                      "rounded-lg border",
                      selectedCount > 0 ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20",
                    )}
                  >
                    <div className="flex items-center gap-2 px-2.5 py-2">
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => toggleExpand(sec.id)}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                      <Checkbox
                        checked={allOn ? true : someOn ? "indeterminate" : false}
                        disabled={disabled || inSection.length === 0}
                        onCheckedChange={() => toggleSection(sec.id)}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => toggleExpand(sec.id)}
                      >
                        <span className="text-sm font-medium">{sec.name}</span>
                        {isSuggested && (
                          <span className="ml-1.5 text-[10px] font-medium text-primary">
                            suggested
                          </span>
                        )}
                      </button>
                      <span className="rounded-full border bg-background px-1.5 text-[10px] tabular-nums">
                        {selectedCount}/{inSection.length}
                      </span>
                    </div>

                    {isOpen && (
                      <div className="space-y-1 border-t px-2.5 py-2">
                        {inSection.length === 0 ? (
                          <p className="px-1 py-1 text-xs text-muted-foreground">
                            No enabled questions in this round.
                          </p>
                        ) : (
                          inSection.map((q) => (
                            <label
                              key={q.id}
                              className={cn(
                                "flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted/50",
                                selectedIds.has(q.id) && "bg-muted/40",
                              )}
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={selectedIds.has(q.id)}
                                disabled={disabled}
                                onCheckedChange={() => toggleQuestion(q.id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="leading-snug">{q.text}</span>
                                {q.description && (
                                  <span className="mt-0.5 block text-xs text-muted-foreground">
                                    {q.description}
                                  </span>
                                )}
                              </span>
                              {selectedIds.has(q.id) && (
                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                              )}
                            </label>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {includePremade && !bank.isLoading && sections.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No enabled question-bank rounds yet. Add them under Questions.
          </p>
        )}

        {includePremade && !bank.isLoading && sections.length > 0 && questions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Rounds exist but no enabled questions. Add or enable questions under Questions.
          </p>
        )}
      </div>
    </div>
  );
}

/** Resolve selected bank questions → payload for AI / batch settings. */
export function selectedPremadePayload(
  questions: PremadeBankQuestion[] | undefined,
  selectedIds: Set<string>,
  includePremade: boolean,
) {
  if (!includePremade || !questions?.length) return undefined;
  const picked = questions.filter((q) => selectedIds.has(q.id));
  if (!picked.length) return undefined;
  return toPremadePayload(picked);
}
