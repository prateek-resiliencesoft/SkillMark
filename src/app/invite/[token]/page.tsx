"use client";

import { writeActiveOrgCookie } from "@/lib/active-org";
import { useAuth } from "@/components/auth-provider";
import { AuralLogo } from "@/components/ui/aural-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

function roleLabel(role: string) {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "VIEWER":
      return "Viewer";
    default:
      return "Member";
  }
}

export default function AcceptOrgInvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const { toast } = useToast();
  const { user, profile, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const invite = trpc.orgMember.getInvite.useQuery(
    { token },
    { retry: false },
  );

  const accept = trpc.orgMember.acceptInvite.useMutation({
    onSuccess: async (data) => {
      toast({ title: "You're in" });
      await utils.organization.list.invalidate();
      router.push("/organizations");
      // Keep org id for the client switcher
      try {
        localStorage.setItem("aural:currentOrgId", data.organizationId);
        writeActiveOrgCookie(data.organizationId);
      } catch {
        /* ignore */
      }
    },
    onError: (err) => {
      toast({
        title: "Could not join",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (invite.data?.status === "ACCEPTED" && user) {
      router.replace("/organizations");
    }
  }, [invite.data?.status, user, router]);

  const pending = invite.data?.status === "PENDING";
  const userEmail = (profile?.email || user?.email || "").toLowerCase();
  const inviteEmail = (invite.data?.email || "").toLowerCase();
  const emailMatches = !!user && !!userEmail && userEmail === inviteEmail;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(700px 320px at 50% -10%, hsl(var(--primary) / 0.12), transparent 60%)",
        }}
      />

      <div className="relative w-full max-w-md space-y-6 rounded-2xl border bg-card/70 p-8 shadow-sm backdrop-blur-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <AuralLogo size={36} priority />
          <p className="font-heading text-xs font-bold tracking-[2px]">
            RESILIENCESOFT INTERVIEW AI
          </p>
        </div>

        {invite.isLoading || authLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-7 w-2/3 mx-auto" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : invite.isError || !invite.data ? (
          <div className="space-y-4 text-center">
            <h1 className="text-xl font-semibold">Invite unavailable</h1>
            <p className="text-sm text-muted-foreground">
              This link is invalid, expired, or was cancelled. Ask the person
              who invited you to send a new one.
            </p>
            <Button asChild variant="outline">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2 text-center">
              <h1 className="text-xl font-semibold tracking-tight">
                Join {invite.data.organization?.name ?? "an organization"}
              </h1>
              <p className="text-sm text-muted-foreground">
                You were invited as{" "}
                <span className="font-medium text-foreground">
                  {roleLabel(invite.data.role)}
                </span>
                .
              </p>
              <div className="flex justify-center gap-2 pt-1">
                <Badge variant="outline" className="font-normal">
                  {invite.data.email}
                </Badge>
                {!pending ? (
                  <Badge variant="secondary" className="font-normal">
                    {invite.data.status === "EXPIRED"
                      ? "Expired"
                      : invite.data.status === "REVOKED"
                        ? "Cancelled"
                        : "Already used"}
                  </Badge>
                ) : null}
              </div>
            </div>

            {invite.data.organization?.paused ? (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-800 dark:text-amber-200">
                This organization is paused. Ask the owner to resume it before
                you can join.
              </p>
            ) : null}

            {!pending ? (
              <Button asChild className="w-full">
                <Link href="/organizations">Back to ResilienceSoft Interview</Link>
              </Button>
            ) : !user ? (
              <div className="space-y-3">
                <p className="text-center text-sm text-muted-foreground">
                  Sign in or create an account with{" "}
                  <span className="font-medium text-foreground">
                    {invite.data.email}
                  </span>{" "}
                  to continue.
                </p>
                <Button asChild className="w-full">
                  <Link
                    href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                  >
                    Sign in to accept
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link
                    href={`/register?next=${encodeURIComponent(`/invite/${token}`)}`}
                  >
                    Create an account
                  </Link>
                </Button>
              </div>
            ) : !emailMatches ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-muted-foreground">
                  You&apos;re signed in as{" "}
                  <span className="font-medium text-foreground">
                    {userEmail || "another account"}
                  </span>
                  . Switch to{" "}
                  <span className="font-medium text-foreground">
                    {invite.data.email}
                  </span>{" "}
                  to accept.
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link
                    href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                  >
                    Switch account
                  </Link>
                </Button>
              </div>
            ) : (
              <Button
                className="w-full"
                disabled={accept.isPending || !!invite.data.organization?.paused}
                onClick={() => accept.mutate({ token })}
              >
                {accept.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Accept invite
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
