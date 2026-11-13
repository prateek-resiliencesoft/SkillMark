"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { AntiCheatingGuard } from "@/components/session/anti-cheating-banner";
import { DisqualifiedScreen, HeadMovementGuard } from "@/components/session/head-movement-guard";
import { IntervieweeOnboarding } from "@/components/session/interviewee-onboarding";
import { PreparingScreen } from "@/components/session/preparing-screen";
import { CandidateThankYou, LinkExpiredScreen } from "@/components/session/candidate-end-screens";
import { Card, CardContent } from "@/components/ui/card";
import { useInterviewLinkGuard } from "@/hooks/use-interview-link-guard";
import { trpc } from "@/lib/trpc/client";
import { Clock } from "lucide-react";
import { formatDateTime } from "@/lib/messaging/templates";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EXPIRED_INVITE_MESSAGE } from "@/lib/session-link";

const ChatInterface = dynamic(
  () => import("@/components/session/chat-interface").then((m) => m.ChatInterface),
  { ssr: false, loading: () => <PreparingScreen /> },
);
const VoiceInterface = dynamic(
  () => import("@/components/session/voice-interface").then((m) => m.VoiceInterface),
  { ssr: false, loading: () => <PreparingScreen /> },
);

export default function InviteSessionPage() {
  const params = useParams();
  const token = params.token as string;
  const router = useRouter();

  const [completed, setCompleted] = useState(false);
  // Set as soon as the interview starts finishing (before saves complete).
  const endingRef = useRef(false);
  const [completionReason, setCompletionReason] = useState<string | undefined>();
  const [disqualified, setDisqualified] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleComplete = (reason?: string) => {
    setCompletionReason(reason);
    setCompleted(true);
  };

  const candidate = trpc.candidate.getByToken.useQuery(
    { token },
    {
      retry: false,
      // Always revalidate — invite page may have cached a pre-session payload.
      refetchOnMount: "always",
      staleTime: 0,
    },
  );

  useEffect(() => {
    if (candidate.isError) {
      router.replace(`/i/invite/${token}`);
      return;
    }
    if (!candidate.data || candidate.isFetching) return;
    const session = (candidate.data as any).session;
    // Only bounce after a fresh fetch confirms there is still no session.
    if (!session) {
      router.replace(`/i/invite/${token}`);
    }
  }, [candidate.data, candidate.isError, candidate.isFetching, token, router]);

  const session = (candidate.data as any)?.session ?? null;
  const interview = (candidate.data as any)?.interview;

  // Interview is live once onboarding is accepted: keep the one-time link alive.
  useInterviewLinkGuard({
    sessionId: session?.id,
    active: onboardingDone && !completed && !disqualified && !linkExpired,
    onExpired: () => setLinkExpired(true),
    isEnding: () => endingRef.current,
  });

  // Onboarding accepted → mark the interview as begun (link becomes single-use).
  const handleOnboardingComplete = async () => {
    if (starting || !session?.id) return;
    setStarting(true);
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { expired?: boolean; error?: string };
      // Only this candidate's own finished session is expired. A new person
      // on the same interview has a different session and must still start.
      if (body.expired) {
        setLinkExpired(true);
        return;
      }
      if (!res.ok) {
        setStartError(body.error || "Could not start this interview. Try again.");
        return;
      }
      setStartError(null);
      setOnboardingDone(true);
    } catch {
      setStartError("Could not start this interview. Try again.");
    } finally {
      setStarting(false);
    }
  };

  // Wait through first load / cache refresh until session appears (or redirect).
  if (candidate.isLoading || !candidate.data || (!session && candidate.isFetching)) {
    return <PreparingScreen />;
  }

  if (!session) {
    return <PreparingScreen />;
  }

  // Fresh completion in this tab → thank-you. Any other visit to a finished link → expired.
  if (completed) {
    return <CandidateThankYou timeLimitReached={completionReason === "TIME_LIMIT_EXCEEDED"} />;
  }

  const isExpired = !!(
    candidate.data.expiresAt &&
    new Date(candidate.data.expiresAt).getTime() < Date.now()
  );

  if (isExpired && session.status !== "COMPLETED") {
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

  if (disqualified || session.status === "DISQUALIFIED") {
    return <DisqualifiedScreen />;
  }

  if (linkExpired || session.status === "ABANDONED") {
    return <LinkExpiredScreen reason="interrupted" />;
  }

  if (session.status === "COMPLETED") {
    return <LinkExpiredScreen reason="used" />;
  }

  if (startError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <h2 className="text-xl font-semibold">Could not start interview</h2>
            <p className="mt-2 text-sm text-muted-foreground">{startError}</p>
            <button
              type="button"
              className="mt-4 text-sm font-medium text-primary hover:underline"
              onClick={() => {
                setStartError(null);
                setStarting(false);
              }}
            >
              Try again
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!onboardingDone) {
    return (
      <IntervieweeOnboarding
        sessionId={session?.id}
        inviteToken={token}
        interviewTitle={interview.title}
        interviewDescription={interview.description}
        questionCount={interview.questions?.length ?? 0}
        timeLimitMinutes={interview.timeLimitMinutes}
        language={interview.language}
        antiCheatingEnabled={!!interview.antiCheatingEnabled}
        voiceEnabled={!!interview.voiceEnabled}
        chatEnabled={!!interview.chatEnabled}
        aiName={interview.aiName}
        questionTypes={(interview.questions ?? []).map((q: any) => q.type as string)}
        scheduledAt={candidate.data.scheduledAt}
        expiresAt={candidate.data.expiresAt}
        oneTimeLink
        onComplete={handleOnboardingComplete}
      />
    );
  }

  const useVoice = interview.voiceEnabled;

  if (useVoice) {
    const interviewContext = {
      title: interview.title,
      objective: interview.objective,
      aiName: interview.aiName,
      aiGender: interview.aiGender,
      aiTone: interview.aiTone,
      language: interview.language,
      followUpDepth: interview.followUpDepth,
      candidateFocus:
        (candidate.data as any).tailorInterview !== false
          ? {
              skills: (candidate.data as any).skills ?? [],
              questions: (candidate.data as any).tailoredQuestions ?? [],
            }
          : null,
      questions: interview.questions.map((q: any) => ({
        text: q.text,
        type: q.type,
        description: q.description,
        options: q.options,
        starterCode: q.starterCode as { language: string; code: string } | null,
        order: q.order,
        skipIf: q.skipIf ?? null,
      })),
    };

    return (
      <>
        <AntiCheatingGuard enabled={!!interview.antiCheatingEnabled} sessionId={session.id} onDisqualified={() => setDisqualified(true)} />
        <HeadMovementGuard enabled={!!interview.antiCheatingEnabled && !!interview.headMovementDetectionEnabled} sessionId={session.id} onDisqualified={() => setDisqualified(true)} />
        <VoiceInterface
          sessionId={session.id}
          interviewId={interview.id}
          interviewTitle={interview.title}
          aiName={interview.aiName}
          questionCount={interview.questions.length}
          interviewContext={interviewContext}
          durationMinutes={interview.timeLimitMinutes ?? undefined}
          chatEnabled={!!interview.chatEnabled}
          onComplete={handleComplete}
          onEnding={() => {
            endingRef.current = true;
          }}
          videoMode={!!interview.videoEnabled}
        />
      </>
    );
  }

  return (
    <>
      <AntiCheatingGuard enabled={!!interview.antiCheatingEnabled} sessionId={session.id} onDisqualified={() => setDisqualified(true)} />
        <HeadMovementGuard enabled={!!interview.antiCheatingEnabled && !!interview.headMovementDetectionEnabled} sessionId={session.id} onDisqualified={() => setDisqualified(true)} />
      <ChatInterface
        sessionId={session.id}
        interview={{
          ...interview,
          questions: interview.questions.map((q: any) => ({
            ...q,
            starterCode: q.starterCode as { language: string; code: string } | null,
          })),
        }}
        durationMinutes={interview.timeLimitMinutes ?? undefined}
        onComplete={handleComplete}
      />
    </>
  );
}
