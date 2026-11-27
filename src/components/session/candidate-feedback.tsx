"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FEEDBACK_COMMENT_MAX, FEEDBACK_TAGS } from "@/lib/candidate-feedback";
import { FEEDBACK_ENHANCE_MIN } from "@/lib/draft-candidate-feedback";
import { cn } from "@/lib/utils";
import { Loader2, Star } from "lucide-react";
import { useEffect, useState } from "react";

const DONE_KEY = (id: string) => `rsi-feedback-${id}`;

/** Optional feedback on the thank-you screen. Hidden when unavailable or already sent. */
export function CandidateFeedback({ sessionId, inviteToken }: { sessionId: string; inviteToken?: string | null }) {
  const [state, setState] = useState<"loading" | "form" | "done" | "hidden">("loading");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    try {
      if (localStorage.getItem(DONE_KEY(sessionId))) {
        setState("done");
        return;
      }
    } catch {
      /* storage blocked */
    }
    const qs = new URLSearchParams({ sessionId, ...(inviteToken ? { token: inviteToken } : {}) });
    fetch(`/api/session/feedback?${qs}`)
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((s: { available?: boolean; submitted?: boolean }) => {
        if (!live) return;
        setState(s.submitted ? "done" : s.available ? "form" : "hidden");
      })
      .catch(() => live && setState("hidden"));
    return () => {
      live = false;
    };
  }, [sessionId, inviteToken]);

  async function enhance() {
    const draft = comment.trim();
    if (draft.length < FEEDBACK_ENHANCE_MIN) {
      setError(`Write at least ${FEEDBACK_ENHANCE_MIN} characters before enhancing.`);
      return;
    }
    setEnhancing(true);
    setError(null);
    try {
      const res = await fetch("/api/session/feedback/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          ...(inviteToken ? { inviteToken } : {}),
          draft,
        }),
      });
      const j = (await res.json().catch(() => null)) as { comment?: string; message?: string } | null;
      if (!res.ok || !j?.comment) {
        setError(j?.message ?? "Could not enhance feedback. Please try again.");
        return;
      }
      setComment(j.comment.slice(0, FEEDBACK_COMMENT_MAX));
    } catch {
      setError("Could not enhance feedback. Please check your connection and try again.");
    } finally {
      setEnhancing(false);
    }
  }

  async function submit() {
    if (!rating) {
      setError("Pick a rating from 1 to 5.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/session/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...(inviteToken ? { inviteToken } : {}), rating, tags, comment: comment.trim() || undefined }),
      });
      if (res.ok || res.status === 409) {
        try {
          localStorage.setItem(DONE_KEY(sessionId), "1");
        } catch {
          /* ignore */
        }
        setState("done");
        return;
      }
      const j = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.status === 503 || res.status === 410 || res.status === 404) setState("hidden");
      else setError(j?.message ?? "Could not send feedback. Please try again.");
    } catch {
      setError("Could not send feedback. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (state === "loading" || state === "hidden") return null;
  if (state === "done") {
    return <p className="mt-6 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Thanks for your feedback.</p>;
  }

  const shown = hover || rating;
  return (
    <div className="mt-6 space-y-3 rounded-lg border p-4 text-left">
      <div>
        <p className="text-sm font-medium">How was your interview experience?</p>
        <p className="text-xs text-muted-foreground">Optional. It helps us improve.</p>
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            className="rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star className={cn("h-7 w-7", n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FEEDBACK_TAGS.map((t) => {
          const on = tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => setTags((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          );
        })}
      </div>
      <div>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, FEEDBACK_COMMENT_MAX))}
          placeholder="Anything else you want to tell us? (optional)"
          rows={3}
          className="text-sm"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={sending || enhancing || comment.trim().length < FEEDBACK_ENHANCE_MIN}
            onClick={() => void enhance()}
          >
            {enhancing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Enhance with AI
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {comment.length}/{FEEDBACK_COMMENT_MAX}
          </p>
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button onClick={submit} disabled={sending || enhancing} size="sm" className="w-full">
        {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Send feedback
      </Button>
    </div>
  );
}
