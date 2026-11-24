"use client";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { Loader2, Video } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Interviewer invite landing: sign in (Google or account), then bind the invite and enter the room. */
export default function RoundTwoInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const info = trpc.roundTwo.inviteInfo.useQuery({ token }, { retry: false, refetchOnWindowFocus: false });
  const accept = trpc.roundTwo.acceptInvite.useMutation({
    onSuccess: (r) => router.replace(`/r2/${r.roundTwoId}/room`),
  });
  const tried = useRef(false);
  const signedIn = info.data?.signedInEmail;

  useEffect(() => {
    if (signedIn && !tried.current) {
      tried.current = true;
      accept.mutate({ token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, token]);

  const next = `/r2/join/${token}`;
  const when = info.data?.scheduledAt
    ? new Date(info.data.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
        {info.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !info.data ? (
          <p className="text-center text-sm text-muted-foreground">This invite link is no longer valid. Ask the host for a new one.</p>
        ) : (
          <div className="space-y-5 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Video className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold">You&apos;re invited to an interview panel</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {info.data.organizationName ? `${info.data.organizationName} · ` : ""}
                {info.data.title}
              </p>
              {when && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {when} · {info.data.durationMin} min
                </p>
              )}
            </div>

            {signedIn ? (
              accept.error ? (
                <div className="space-y-3">
                  <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{accept.error.message}</p>
                  <Button variant="outline" className="w-full" asChild>
                    <a href={`/login?add=1&next=${encodeURIComponent(next)}`}>Use a different account</a>
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Joining as {signedIn}…
                </div>
              )
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sign in with the invited address <strong>{info.data.emailHint}</strong> to join.
                </p>
                <Button className="w-full" asChild>
                  <a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>Continue with Google</a>
                </Button>
                <Button variant="outline" className="w-full" asChild>
                  <a href={`/login?next=${encodeURIComponent(next)}`}>Sign in with email</a>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
