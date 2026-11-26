"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Star } from "lucide-react";
import { useState } from "react";

/** Short, optional experience feedback shown to the candidate after the interview (1-5 stars + a comment). */
export function CandidateFeedbackCard({ token, className }: { token: string; className?: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "skipped">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") return <p className={cn("text-sm font-medium", className)}>Thank you for your feedback!</p>;
  if (state === "skipped") return null;

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/round-two/candidate/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, comment: comment.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) throw new Error(body.error || "Couldn't send your feedback");
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send your feedback");
      setState("idle");
    }
  };

  return (
    <div className={cn("w-full max-w-md space-y-3 rounded-xl border bg-card p-4 text-left text-card-foreground", className)}>
      <div>
        <div className="font-semibold">How was your interview experience?</div>
        <p className="text-xs text-muted-foreground">Optional. It takes a few seconds and helps the hiring team improve.</p>
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setRating(n)}
            className="rounded p-1 hover:bg-muted"
          >
            <Star className={cn("h-7 w-7", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
          </button>
        ))}
      </div>
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} placeholder="Anything you'd like to tell us? (optional)" className="text-sm" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={!rating || state === "sending"} onClick={() => void send()}>
          {state === "sending" ? "Sending…" : "Send feedback"}
        </Button>
        <Button variant="ghost" onClick={() => setState("skipped")}>
          Skip
        </Button>
      </div>
    </div>
  );
}
