import { ENDPOINTING_CONFIG, type EndpointingConfig } from "./endpointing-config";

/**
 * Trailing fillers only — mid-sentence "like"/"actually" in a finished answer
 * must not force a hold or check-in.
 */
const TRAILING_FILLER_RE =
  /\b(um+|uh+|uhm+|hmm+|mm+|er+|ah+|like|actually|basically|literally|you\s*know|i\s*mean|matlab|toh|yaar|well)\s*$/i;

/**
 * Trailing conjunctions / prepositions — answer is almost certainly unfinished.
 * Includes short prepositions common at cut-offs ("…working for", "…internship in").
 */
const TRAILING_CONJ_RE =
  /\b(and|but|or|because|so|then|if|when|while|to|for|with|that|which|although|however|plus|also|of|in|on|at|from|about|into|over)\s*[,…]?\s*$/i;

/** Stutter / repeated short tokens: "I I", "the the", "my my". */
const REPEATED_WORD_RE = /\b([a-zA-Z']{1,12})\s+\1\b/;

/** Cut-off last token (trailing hyphen / ellipsis / single dangling letter). */
const CUTOFF_RE = /(-|\.\.\.|…)\s*$|\b[a-z]\s*$/i;

export interface HesitationSignals {
  hasTrailingFiller: boolean;
  hasRepeatedWord: boolean;
  hasTrailingConjunction: boolean;
  hasCutoff: boolean;
  isEmpty: boolean;
}

export interface EndpointDecisionInput {
  /** Milliseconds of silence since Silero reported speech end. */
  silenceMs: number;
  /** Live / partial transcript for the current user turn (from Gemini ASR). */
  transcript: string;
  /** How long the candidate has been speaking this turn (ms). */
  speechDurationMs: number;
  config?: EndpointingConfig;
}

export type EndpointAction = "hold" | "end_turn" | "check_in";

export interface EndpointDecision {
  shouldEnd: boolean;
  action: EndpointAction;
  targetSilenceMs: number;
  hesitant: boolean;
  signals: HesitationSignals;
  reason: string;
}

export function analyzeHesitation(
  transcript: string,
  _speechDurationMs: number,
  _config: EndpointingConfig = ENDPOINTING_CONFIG,
): HesitationSignals {
  const text = transcript.replace(/\s+/g, " ").trim();
  return {
    isEmpty: text.length === 0,
    hasTrailingFiller: TRAILING_FILLER_RE.test(text),
    hasRepeatedWord: REPEATED_WORD_RE.test(text),
    hasTrailingConjunction: TRAILING_CONJ_RE.test(text),
    hasCutoff: CUTOFF_RE.test(text),
  };
}

export function looksIncomplete(signals: HesitationSignals): boolean {
  return (
    signals.hasTrailingFiller ||
    signals.hasRepeatedWord ||
    signals.hasTrailingConjunction ||
    signals.hasCutoff
  );
}

export function isHesitant(signals: HesitationSignals): boolean {
  return looksIncomplete(signals);
}

/** How long to wait after speech ends before closing the turn. */
export function targetSilenceMsForTurn(
  signals: HesitationSignals,
  speechDurationMs = 0,
  config: EndpointingConfig = ENDPOINTING_CONFIG,
): number {
  if (looksIncomplete(signals)) {
    return Math.min(config.maxPauseMs, config.hesitantPauseMs);
  }
  // Long self-intros / multi-sentence answers: need a longer quiet gap so a
  // natural breath between sentences does not cut them off.
  if (speechDurationMs >= config.longAnswerSpeechMs) {
    return Math.min(config.maxPauseMs, config.longAnswerDonePauseMs);
  }
  return Math.min(config.maxPauseMs, config.donePauseMs);
}

/**
 * Decide whether silence so far is enough to end the candidate's turn.
 * Check-in only when unfinished-looking after the full hesitant hold.
 * Clear short answers end at ~1.5s; long answers need a longer quiet gap.
 */
export function decideEndpoint(input: EndpointDecisionInput): EndpointDecision {
  const config = input.config ?? ENDPOINTING_CONFIG;
  const signals = analyzeHesitation(input.transcript, input.speechDurationMs, config);
  const hesitant = looksIncomplete(signals);
  const targetSilenceMs = targetSilenceMsForTurn(
    signals,
    input.speechDurationMs,
    config,
  );

  if (input.silenceMs < Math.min(config.decisionAfterSilenceMs, targetSilenceMs)) {
    return {
      shouldEnd: false,
      action: "hold",
      targetSilenceMs,
      hesitant,
      signals,
      reason: "waiting_for_decision_window",
    };
  }

  if (input.silenceMs >= targetSilenceMs) {
    if (hesitant && config.checkInOncePerQuestion) {
      return {
        shouldEnd: true,
        action: "check_in",
        targetSilenceMs,
        hesitant,
        signals,
        reason: "hesitant_check_in",
      };
    }
    return {
      shouldEnd: true,
      action: "end_turn",
      targetSilenceMs,
      hesitant,
      signals,
      reason: hesitant
        ? "hesitant_pause_elapsed"
        : input.speechDurationMs >= config.longAnswerSpeechMs
          ? "long_answer_done_pause_elapsed"
          : "done_pause_elapsed",
    };
  }

  return {
    shouldEnd: false,
    action: "hold",
    targetSilenceMs,
    hesitant,
    signals,
    reason: hesitant
      ? "holding_for_hesitation"
      : input.speechDurationMs >= config.longAnswerSpeechMs
        ? "holding_for_long_answer_pause"
        : "holding_for_done_pause",
  };
}
