"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CODE_LANGUAGES } from "@/lib/code-languages";
import type { CodingTask } from "@/lib/round-two/boards";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";

function LanguageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={SELECT} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Language">
      {CODE_LANGUAGES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

/** Pick the live coding task: question bank (CODING items), typed by the panel, or AI-written. */
export function CodingTaskDialog({
  roundTwoId,
  open,
  onOpenChange,
  onPick,
  busy,
}: {
  roundTwoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = open the editor without a task. */
  onPick: (task: CodingTask | null) => void;
  busy?: boolean;
}) {
  const [tab, setTab] = useState("bank");
  const bank = trpc.roundTwo.codingTasks.useQuery({ id: roundTwoId }, { enabled: open, staleTime: 60_000, refetchOnWindowFocus: false });
  const [picked, setPicked] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState("python");
  const [starter, setStarter] = useState("");
  const [hint, setHint] = useState("");
  const [aiTask, setAiTask] = useState<CodingTask | null>(null);
  const generate = trpc.roundTwo.generateCodingTask.useMutation({ onSuccess: (t) => setAiTask(t) });

  const bankTask = bank.data?.find((t) => t.id === picked) ?? null;
  const typedTask: CodingTask | null = prompt.trim()
    ? { id: `typed-${Date.now().toString(36)}`, source: "typed", title: title.trim() || prompt.trim().split("\n")[0].slice(0, 80), prompt: prompt.trim(), language, starter: starter.trim() ? starter : null }
    : null;
  const chosen = tab === "bank" ? bankTask : tab === "typed" ? typedTask : aiTask;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Coding task</DialogTitle>
          <DialogDescription>The candidate sees the task above the editor and writes the code; the panel follows live.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="bank">Question bank</TabsTrigger>
            <TabsTrigger value="typed">Write one</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
          </TabsList>
          <TabsContent value="bank" className="max-h-[50vh] space-y-2 overflow-auto">
            {bank.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {bank.error && <p className="text-sm text-destructive">{bank.error.message}</p>}
            {bank.data?.length === 0 && <p className="text-sm text-muted-foreground">No CODING questions in your question bank yet.</p>}
            {bank.data?.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPicked(t.id)}
                className={cn("w-full rounded-lg border p-3 text-left text-sm", picked === t.id ? "border-primary bg-primary/5" : "hover:bg-muted/50")}
              >
                <div className="font-medium">{t.title}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{t.prompt}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t.language}{t.starter ? " · starter code" : ""}</div>
              </button>
            ))}
          </TabsContent>
          <TabsContent value="typed" className="space-y-2">
            <Input placeholder="Title (optional)" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            <Textarea placeholder="Problem statement" rows={5} value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} />
            <LanguageSelect value={language} onChange={setLanguage} />
            <Textarea placeholder="Starter code (optional)" rows={5} className="font-mono text-xs" value={starter} maxLength={20000} onChange={(e) => setStarter(e.target.value)} />
          </TabsContent>
          <TabsContent value="ai" className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Input className="min-w-0 flex-1" placeholder="What to test (optional), e.g. arrays, SQL joins, debouncing" value={hint} maxLength={600} onChange={(e) => setHint(e.target.value)} />
              <LanguageSelect value={language} onChange={setLanguage} />
              <Button type="button" variant="secondary" disabled={generate.isLoading} onClick={() => generate.mutate({ id: roundTwoId, hint, language })}>
                {generate.isLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                Generate
              </Button>
            </div>
            {generate.error && <p className="text-sm text-destructive">{generate.error.message}</p>}
            {aiTask && (
              <div className="max-h-[40vh] overflow-auto rounded-lg border p-3 text-sm">
                <div className="font-medium">{aiTask.title}</div>
                <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{aiTask.prompt}</div>
                {aiTask.starter && <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">{aiTask.starter}</pre>}
              </div>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onPick(null)}>
            Open without a task
          </Button>
          <Button type="button" disabled={!chosen || busy} onClick={() => chosen && onPick(chosen)}>
            Use this task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
