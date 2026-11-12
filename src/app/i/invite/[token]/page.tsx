"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent } from "@/components/ui/card";
import { Link2Off, Clock } from "lucide-react";
import { PreparingScreen } from "@/components/session/preparing-screen";
import { LinkExpiredScreen } from "@/components/session/candidate-end-screens";
import { isLinkConsumed } from "@/lib/session-link";
import { formatDateTime } from "@/lib/messaging/templates";
import { EXPIRED_INVITE_MESSAGE } from "@/lib/session-link";
import { collectDeviceInfo } from "@/lib/preflight";

export default function InvitePage() {
  const params = useParams();
  const token = params.token as string;
  const router = useRouter();
  const utils = trpc.useUtils();

  const [completed, setCompleted] = useState(false);
  const sessionCreationAttempted = useRef(false);

  const candidate = trpc.candidate.getByToken.useQuery(
    { token },
    { retry: false },
  );

  const sessionPath = `/i/invite/${token}/session`;

  const linkOpened = useRef(false);
  useEffect(() => {
    if (!token || !candidate.data || linkOpened.current) return;
    if (candidate.data.expiresAt && new Date(candidate.data.expiresAt).getTime() < Date.now()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (candidate.data as any).session;
    if (session && (session.status === "COMPLETED" || session.status === "ABANDONED" || session.status === "DISQUALIFIED")) {
      return;
    }
    linkOpened.current = true;
    void fetch("/api/session/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        sessionId: session?.id,
        type: "link_opened",
        status: "done",
        device: collectDeviceInfo(),
      }),
      keepalive: true,
    }).catch(() => {});
  }, [token, candidate.data]);

  const goToSession = useCallback(() => {
    router.push(sessionPath);
  }, [router, sessionPath]);

  const createSession = trpc.session.createFromInvite.useMutation({
    onSuccess: async () => {
      // Drop stale getByToken cache (no session) so the session page does not
      // bounce back here and leave the candidate stuck on PreparingScreen.
      await utils.candidate.getByToken.invalidate({ token });
      goToSession();
    },
  });

  useEffect(() => {
    router.prefetch(sessionPath);
  }, [router, sessionPath]);

  useEffect(() => {
    if (!candidate.data || completed) return;
    if (createSession.isPending || createSession.isError) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = (candidate.data as any).session;
    if (session) {
      // One-time link: finished / interrupted / already-running interviews never reopen here.
      if (
        session.status === "COMPLETED" ||
        session.status === "ABANDONED" ||
        (session.status === "IN_PROGRESS" && session.interviewBeganAt)
      ) {
        setCompleted(true);
      } else {
        goToSession();
      }
      return;
    }

    // Check expiration before creating a new session
    const isExpired = !!(
      candidate.data.expiresAt &&
      new Date(candidate.data.expiresAt).getTime() < Date.now()
    );
    if (isExpired) {
      return;
    }

    if (!sessionCreationAttempted.current) {
      sessionCreationAttempted.current = true;
      createSession.mutate({ inviteToken: token });
    }
  }, [
    candidate.data,
    completed,
    createSession,
    createSession.isPending,
    createSession.isError,
    token,
    goToSession,
  ]);

  // Loading
  if (candidate.isLoading) {
    return <PreparingScreen />;
  }

  // Error / invalid token
  if (candidate.isError || !candidate.data) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Link2Off className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold">
              {/expired/i.test(candidate.error?.message ?? "") ? "This link has expired" : "Invalid Invite Link"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {/expired/i.test(candidate.error?.message ?? "")
                ? EXPIRED_INVITE_MESSAGE
                : "This invite link is invalid or the interview is no longer available."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check expired
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (candidate.data as any).session;
  const isExpired = !!(
    candidate.data.expiresAt &&
    new Date(candidate.data.expiresAt).getTime() < Date.now()
  );

  if (isExpired && !isLinkConsumed(session?.status)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md border-amber-200/50 shadow-sm">
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
              <Clock className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold">This link has expired</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {EXPIRED_INVITE_MESSAGE}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              This invitation expired on{" "}
              <span className="font-medium text-foreground">
                {formatDateTime(candidate.data.expiresAt)}
              </span>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // One-time link already used (finished, interrupted, or running in another tab)
  if (
    completed ||
    session?.status === "COMPLETED" ||
    session?.status === "ABANDONED" ||
    (session?.status === "IN_PROGRESS" && session?.interviewBeganAt)
  ) {
    return (
      <LinkExpiredScreen
        reason={session?.status === "ABANDONED" ? "interrupted" : "used"}
      />
    );
  }

  if (createSession.isError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Link2Off className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold">Could not start interview</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {createSession.error?.message ||
                "Failed to create your session. Refresh the page or contact the hiring team."}
            </p>
            <button
              type="button"
              className="mt-4 text-sm font-medium text-primary hover:underline"
              onClick={() => {
                sessionCreationAttempted.current = false;
                createSession.reset();
                createSession.mutate({ inviteToken: token });
              }}
            >
              Try again
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Creating session / navigating
  return <PreparingScreen />;
}
