"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { leftFollowupState, type FollowupCandidate, type FollowupSession } from "@/lib/left-followup";
import { trpc } from "@/lib/trpc/client";
import { CheckCircle2, Loader2, MessageCircle, Send } from "lucide-react";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * For a candidate who left the interview: shows whether the WhatsApp follow-up was sent and,
 * when it was not, a button to send it by hand. Renders nothing for anyone who did not leave.
 */
export function LeftFollowupAction({
  candidateId,
  candidate,
  session,
  variant = "card",
  onDone,
}: {
  candidateId: string;
  candidate: FollowupCandidate | null | undefined;
  session: FollowupSession | null | undefined;
  /** "card": full section (detail panel). "compact": one-line link (table rows). */
  variant?: "card" | "compact";
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const send = trpc.candidate.sendLeftFollowup.useMutation({
    onSuccess: (r) => {
      if (r.status === "sent") {
        toast({ title: "Follow-up sent", description: "The candidate can restart the interview from their invite link." });
      } else {
        toast({
          title: r.status === "failed" ? "Follow-up failed" : "Follow-up not sent",
          description: r.error,
          variant: "destructive",
        });
      }
      void utils.candidate.getById.invalidate({ id: candidateId });
      void utils.candidate.listAll.invalidate();
      onDone?.();
    },
    onError: (err) => toast({ title: "Follow-up failed", description: err.message, variant: "destructive" }),
  });

  const state = leftFollowupState(candidate, session);
  if (!state.applicable) return null;

  if (variant === "compact") {
    if (state.sent) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600" title={`Follow-up sent ${when(state.sentAt)}`}>
          <CheckCircle2 className="h-3 w-3" /> Follow-up sent
        </span>
      );
    }
    return (
      <button
        type="button"
        disabled={send.isLoading}
        onClick={(e) => {
          e.stopPropagation();
          send.mutate({ candidateId });
        }}
        title={state.error ?? "Send the WhatsApp message so they can restart the interview"}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 hover:underline disabled:opacity-60"
      >
        {send.isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        Follow-up not sent · Send
      </button>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Left-interview follow-up</h4>
      </div>
      {state.sent ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          WhatsApp follow-up sent{state.sentAt ? ` on ${when(state.sentAt)}` : ""}. The candidate can restart from their invite link.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            This candidate left the interview and has not received the WhatsApp message with their link to restart it.
          </p>
          {state.error && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              Last attempt: {state.error}
            </p>
          )}
          <Button size="sm" disabled={send.isLoading} onClick={() => send.mutate({ candidateId })}>
            {send.isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Send follow-up on WhatsApp
          </Button>
        </div>
      )}
    </section>
  );
}
