"use client";

import { writeActiveOrgCookie } from "@/lib/active-org";
import { useAuth } from "@/components/auth-provider";
import { ProductLogo } from "@/components/ui/product-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

  const invite = trpc.orgMember.getInvite.useQuery({ token }, { retry: false });

  const accept = trpc.orgMember.acceptInvite.useMutation({
    onSuccess: async (data) => {
      toast({ title: "You're in" });
      await utils.organization.list.invalidate();
      try {
        localStorage.setItem("aural:currentOrgId", data.organizationId);
        writeActiveOrgCookie(data.organizationId);
      } catch {
        /* ignore */
      }
      router.push("/organizations");
    },
    onError: (err) => {
      toast({
        title: "Could not join",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (invite.data?.status === "ACCEPTED" && user) {
      router.replace("/organizations");
    }
  }, [invite.data?.status, user, router]);

  const pending = invite.data?.status === "PENDING";
  const userEmail = (profile?.email || user?.email || "").toLowerCase();
  const inviteEmail = (invite.data?.email || "").toLowerCase();
  const emailMatches = !!user && !!userEmail && userEmail === inviteEmail;
  const hasAccount = invite.data?.hasAccount === true;

  const finishJoin = (organizationId: string) => {
    toast({ title: "You're in" });
    try {
      localStorage.setItem("aural:currentOrgId", organizationId);
      writeActiveOrgCookie(organizationId);
    } catch {
      /* ignore */
    }
    window.location.href = "/organizations";
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite.data?.email) return;
    setJoining(true);
    try {
      const res = await fetch("/api/auth/invite-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          token,
          password,
          name: hasAccount ? undefined : name.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: hasAccount ? "Could not sign in" : "Could not create account",
          description: json.error || "Something went wrong. Try again.",
          variant: "destructive",
        });
        setJoining(false);
        return;
      }
      await utils.organization.list.invalidate();
      finishJoin(String(json.organizationId));
    } catch (err: unknown) {
      toast({
        title: "Connection error",
        description: err instanceof Error ? err.message : "Could not reach the server.",
        variant: "destructive",
      });
      setJoining(false);
    }
  };

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
          <ProductLogo size={36} priority />
          <p className="font-heading text-xs font-bold tracking-[2px]">
            RESILIENCESOFT INTERVIEW AI
          </p>
        </div>

        {invite.isLoading || authLoading ? (
          <div className="space-y-3">
            <Skeleton className="mx-auto h-7 w-2/3" />
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
                {invite.data.project ? (
                  <>
                    You were invited to the{" "}
                    <span className="font-medium text-foreground">
                      {invite.data.project.name}
                    </span>{" "}
                    project as{" "}
                    <span className="font-medium text-foreground">
                      {roleLabel(invite.data.project.role)}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    You were invited as{" "}
                    <span className="font-medium text-foreground">
                      {roleLabel(invite.data.role)}
                    </span>
                    .
                  </>
                )}
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
            ) : emailMatches ? (
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
            ) : (
              <form onSubmit={handleJoin} className="space-y-4">
                {user && !emailMatches ? (
                  <p className="text-center text-sm text-muted-foreground">
                    Signed in as{" "}
                    <span className="font-medium text-foreground">
                      {userEmail || "another account"}
                    </span>
                    . Join with{" "}
                    <span className="font-medium text-foreground">
                      {invite.data.email}
                    </span>{" "}
                    instead.
                  </p>
                ) : (
                  <p className="text-center text-sm text-muted-foreground">
                    {hasAccount
                      ? "Enter the password for this email to join."
                      : "Create a password for this email to join. No account yet."}
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={invite.data.email}
                    readOnly
                    className="bg-muted/50"
                  />
                </div>

                {!hasAccount ? (
                  <div className="space-y-2">
                    <Label htmlFor="invite-name">Full name</Label>
                    <Input
                      id="invite-name"
                      type="text"
                      placeholder="Jane Doe"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="invite-password">
                    {hasAccount ? "Password" : "Choose a password"}
                  </Label>
                  <div className="relative">
                    <Input
                      id="invite-password"
                      type={showPassword ? "text" : "password"}
                      placeholder={hasAccount ? "Your password" : "At least 8 characters"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={hasAccount ? 1 : 8}
                      autoComplete={hasAccount ? "current-password" : "new-password"}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={joining || !!invite.data.organization?.paused}
                >
                  {joining ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {hasAccount ? "Sign in and join" : "Create account and join"}
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
