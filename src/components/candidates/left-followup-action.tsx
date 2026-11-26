"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { leftFollowupState, type FollowupCandidate, type FollowupSession } from "@/lib/left-followup";
import { trpc } from "@/lib/trpc/client";
import { CheckCircle2, CircleAlert, Loader2, MessageCircle, Send } from "lucide-react";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Left-interview WhatsApp follow-up status for one candidate: "sent" (with when), or "not sent"
 * with the reason and a button to send it by hand. Renders nothing for anyone who did not leave
 * and never received one.
 */
export function LeftFollowupAction({
  candidateId,
  candidate,
  session,
  variant = "card",
  canSend = true,
  onDone,
}: {
  candidateId: string;
  candidate: FollowupCandidate | null | undefined;
  session: FollowupSession | null | undefined;
  /** "card": full section (detail panel). "compact": status line (table cells). */
  variant?: "card" | "compact";
  /** False for read-only viewers: status only, no send button. */
  canSend?: boolean;
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
      void utils.batch.getById.invalidate();
      onDone?.();
    },
    onError: (err) => toast({ title: "Follow-up failed", description: err.message, variant: "destructive" }),
  });

  const state = leftFollowupState(candidate, session);
  if (!state.relevant) return null;
  const sendable = canSend && state.applicable && !state.sent;
  const blockedReason = state.expired ? "The invite link has expired. Extend the expiry to send it." : null;
  const reason = state.error ?? blockedReason;

  if (variant === "compact") {
    if (state.sent) {
      return (
        <span
          className="inline-flex flex-col items-start text-[10px] leading-tight text-emerald-600"
          title="interview_incomplete_reminder sent"
        >
          <span className="inline-flex items-center gap-1 font-medium">
            <CheckCircle2 className="h-3 w-3" /> Reminder sent
          </span>
          {state.sentAt && <span className="text-muted-foreground">{when(state.sentAt)}</span>}
        </span>
      );
    }
    return (
      <span className="inline-flex max-w-[220px] flex-col items-start text-[10px] leading-tight" title={reason ?? undefined}>
        <span className="inline-flex items-center gap-1 font-medium text-amber-600">
          <CircleAlert className="h-3 w-3" />
          {state.error ? "Reminder failed" : "Reminder not sent"}
          {sendable && (
            <button
              type="button"
              disabled={send.isLoading}
              onClick={(e) => {
                e.stopPropagation();
                send.mutate({ candidateId });
              }}
              className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline disabled:opacity-60"
            >
              {send.isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Send manually
            </button>
          )}
        </span>
        {reason && <span className="line-clamp-2 text-muted-foreground">{reason}</span>}
      </span>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Incomplete-interview reminder</h4>
        <span
          className={
            state.sent
              ? "ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          }
        >
          {state.sent ? "Sent" : state.error ? "Send failed" : "Not sent"}
        </span>
      </div>
      {state.sent ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          interview_incomplete_reminder sent{state.sentAt ? ` on ${when(state.sentAt)}` : ""}. Candidate can resume from the invite link.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Candidate left early. Auto-send uses WhatsApp template interview_incomplete_reminder with the resume link.
            {sendable ? " If auto-send failed or was skipped, send it manually below." : ""}
          </p>
          {reason && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              {state.error ? `Last attempt failed: ${state.error}` : reason}
            </p>
          )}
          {sendable && (
            <Button size="sm" disabled={send.isLoading} onClick={() => send.mutate({ candidateId })}>
              {send.isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Send reminder manually
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
