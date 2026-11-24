"use client";

import { ReasoningTimeline } from "@/components/ai/reasoning-timeline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { ReasoningStep } from "@/lib/ai/graph/types";
import type { QuestionPlanItem } from "@/lib/round-two/types";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; steps?: ReasoningStep[]; gaps?: string[] };

const QUICK_PROMPTS = [
  "Draft the round 2 plan",
  "Focus on round 1 weak areas",
  "Cross-check the CV claims",
  "Add a system design question",
  "Make it fit 30 minutes",
];

/** Chat with the AI to build / revise the round 2 question plan. */
export function PlanChat({
  roundTwoId,
  durationMin,
  onPlan,
  autoStart,
}: {
  roundTwoId: string;
  durationMin: number;
  onPlan: (plan: QuestionPlanItem[]) => void;
  autoStart?: boolean;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const chat = trpc.roundTwo.planChat.useMutation({
    onSuccess: (out) => {
      setMessages((m) => [...m, { role: "assistant", content: out.reply, steps: out.steps, gaps: out.gaps }]);
      onPlan(out.plan);
    },
    onError: (err) => {
      setMessages((m) => m.slice(0, -1));
      toast({ title: "AI request failed", description: err.message, variant: "destructive" });
    },
  });

  // Steps are saved as each one finishes, so polling the newest run gives a live timeline.
  const sentAt = useRef(0);
  const liveRun = trpc.aiRuns.forSubject.useQuery(
    { subjectType: "round_two", subjectId: roundTwoId, flows: ["round2-plan"], limit: 1 },
    { enabled: chat.isLoading, refetchInterval: chat.isLoading ? 1500 : false },
  );
  const live = liveRun.data?.runs[0];
  const liveSteps = live && new Date(live.startedAt).getTime() >= sentAt.current - 5_000 ? live.steps : [];

  const send = (text: string) => {
    const instruction = text.trim();
    if (!instruction || chat.isLoading) return;
    const history = messages;
    setMessages([...history, { role: "user", content: instruction }]);
    setInput("");
    sentAt.current = Date.now();
    chat.mutate({ id: roundTwoId, instruction, history, durationMin });
  };

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      send("Draft the round 2 plan");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, chat.isLoading]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 && !chat.isLoading && (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <Sparkles className="mb-1.5 h-4 w-4 text-primary" />
            The AI knows the round 1 transcript, score, weak areas, claims and CV. Ask it to draft questions, then refine.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("max-w-[90%] space-y-1.5", m.role === "user" && "ml-auto")}>
            <div
              className={cn(
                "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {m.content}
              {!!m.gaps?.length && (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-amber-700 dark:text-amber-400">
                  {m.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              )}
            </div>
            {!!m.steps?.length && <ReasoningTimeline steps={m.steps} collapsible defaultOpen={false} />}
          </div>
        ))}
        {chat.isLoading &&
          (liveSteps.length ? (
            <ReasoningTimeline steps={liveSteps} title="What the AI is doing" className="max-w-[90%]" />
          ) : (
            <div className="flex w-fit items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </div>
          ))}
        <div ref={bottom} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => send(p)}
            disabled={chat.isLoading}
            className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder="e.g. Add two questions on their Kafka migration claim"
          className="text-sm"
        />
        <Button size="icon" onClick={() => send(input)} disabled={chat.isLoading || !input.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
