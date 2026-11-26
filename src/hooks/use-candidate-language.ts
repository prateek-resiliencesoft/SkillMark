"use client";

import { useCallback, useState } from "react";
import { isMultiLanguage, normalizeCandidateLanguage, type CandidateLanguage } from "@/lib/interview-language";

/**
 * Multi-language interviews: the language the candidate picks in onboarding.
 * Starts from the saved session value (reload / resume) and is stored on the
 * session when chosen. Other interviews: always null.
 */
export function useCandidateLanguage(
  sessionId: string | null | undefined,
  interviewLanguage: string | null | undefined,
  savedLanguage: string | null | undefined,
) {
  const [chosen, setChosen] = useState<CandidateLanguage | null>(null);
  const multi = isMultiLanguage(interviewLanguage);
  const candidateLanguage = multi ? chosen ?? normalizeCandidateLanguage(savedLanguage) : null;

  const choose = useCallback(
    (language: CandidateLanguage) => {
      setChosen(language);
      if (!sessionId) return;
      void fetch("/api/voice/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, language }),
      }).catch(() => undefined);
    },
    [sessionId],
  );

  return { candidateLanguage, chooseLanguage: multi ? choose : undefined };
}
