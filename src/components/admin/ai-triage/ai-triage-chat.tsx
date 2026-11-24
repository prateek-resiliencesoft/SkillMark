"use client";

import { Panel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function AiTriageChatPanel() {
  const { toast } = useToast();
  const [chatInput, setChatInput] = useState("");
  const [chatMsgs, setChatMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

  const chatMut = trpc.bugTriage.chat.useMutation({
    onSuccess: (res) => setChatMsgs((m) => [...m, { role: "assistant", content: res.reply }]),
    onError: (e) => toast({ title: "Chat failed", description: e.message, variant: "destructive" }),
  });

  function sendChat() {
    const text = chatInput.trim();
    if (!text || chatMut.isLoading) return;
    const next = [...chatMsgs, { role: "user" as const, content: text }];
    setChatMsgs(next);
    setChatInput("");
    chatMut.mutate({ messages: next });
  }

  return (
    <Panel className="flex max-w-3xl flex-col gap-3 p-4">
      <div className="max-h-[480px] min-h-[280px] space-y-3 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-3">
        {chatMsgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask about hot buckets, thresholds, or what a GitHub issue covers. Uses platform AI keys (Keys tab) or{" "}
            <code>.env</code> fallback.
          </p>
        ) : (
          chatMsgs.map((m, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "ml-8 bg-primary/10" : "mr-8 border border-border/50 bg-card",
              )}
            >
              {m.content}
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="e.g. Which error/critical bugs are closest to the threshold?"
          className="min-h-[60px] text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendChat();
            }
          }}
        />
        <Button type="button" className="shrink-0 self-end" disabled={chatMut.isLoading} onClick={sendChat}>
          Send
        </Button>
      </div>
    </Panel>
  );
}
