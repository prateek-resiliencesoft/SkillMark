"use client";

import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Clock, WifiOff } from "lucide-react";
import { EXPIRED_INVITE_MESSAGE } from "@/lib/session-link";

export const PRODUCT_SITE_URL = "https://resiliencesoftinterview.com";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="py-12 text-center">{children}</CardContent>
      </Card>
    </div>
  );
}

/** Shown right after a candidate finishes. */
export function CandidateThankYou({
  timeLimitReached = false,
  saving = false,
}: {
  timeLimitReached?: boolean;
  /** Final save still running: ask the candidate to keep the tab open briefly. */
  saving?: boolean;
}) {
  return (
    <Shell>
      <CheckCircle2 className="mx-auto h-16 w-16 text-secondary-500" />
      <h2 className="mt-4 text-2xl font-bold">Thank you!</h2>
      {timeLimitReached && (
        <p className="mt-2 text-sm text-amber-600">
          The session time limit has been reached and the interview was ended automatically.
        </p>
      )}
      <p className="mt-2 text-muted-foreground">
        Your interview is complete. Our team will review your interview and contact you.
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        {saving
          ? "Saving your interview… please keep this tab open for a few seconds."
          : "You can now close this tab."}
      </p>
    </Shell>
  );
}

/** Shown when a one-time link was already used, ended, interrupted, or revoked. */
export function LinkExpiredScreen({ reason = "used" }: { reason?: "used" | "interrupted" | "expired" }) {
  return (
    <Shell>
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
        {reason === "interrupted" ? <WifiOff className="h-7 w-7" /> : <Clock className="h-7 w-7" />}
      </div>
      <h2 className="text-xl font-semibold">This link has expired</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {reason === "used"
          ? "This interview link can only be used once, and it has already been used."
          : EXPIRED_INVITE_MESSAGE}
      </p>
      {reason === "used" && (
        <p className="mt-3 text-xs text-muted-foreground">{EXPIRED_INVITE_MESSAGE}</p>
      )}
    </Shell>
  );
}
