import { ENDPOINTING_CONFIG, type EndpointingConfig } from "./endpointing-config";

/**
 * Trailing fillers only — mid-sentence "like"/"actually" in a finished answer
 * must not force a hold or check-in.
 */
const TRAILING_FILLER_RE =
  /\b(um+|uh+|uhm+|hmm+|mm+|er+|ah+|like|actually|basically|literally|you\s*know|i\s*mean|matlab|toh|yaar|well)\s*$/i;

/** Trailing conjunctions / prepositions — answer is almost certainly unfinished. */
const TRAILING_CONJ_RE =
  /\b(and|but|or|because|so|then|if|when|while|to|for|with|that|which|although|however|plus|also)\s*[,…]?\s*$/i;

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
  /**
   * - hold: keep listening
   * - end_turn: activityEnd (complete — AI replies normally, no check-in)
   * - check_in: activityEnd + once-per-question “[add anything?]” cue
   */
  action: EndpointAction;
  targetSilenceMs: number;
  /** True when the transcript looks unfinished (stutter / trailing / cut-off). */
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

/**
 * Unfinished-looking speech that deserves a longer hold (and maybe a check-in
 * if they stay silent through it). Short-but-complete answers are NOT included.
 */
export function looksIncomplete(signals: HesitationSignals): boolean {
  return (
    signals.hasTrailingFiller ||
    signals.hasRepeatedWord ||
    signals.hasTrailingConjunction ||
    signals.hasCutoff
  );
}

/** @deprecated use looksIncomplete — kept for call-site clarity */
export function isHesitant(signals: HesitationSignals): boolean {
  return looksIncomplete(signals);
}

/** How long to wait after speech ends before closing the turn. */
export function targetSilenceMsForTurn(
  signals: HesitationSignals,
  config: EndpointingConfig = ENDPOINTING_CONFIG,
): number {
  const raw = looksIncomplete(signals) ? config.hesitantPauseMs : config.donePauseMs;
  return Math.min(config.maxPauseMs, raw);
}

/**
 * Decide whether silence so far is enough to end the candidate's turn.
 * Call this repeatedly while Silero reports the candidate is not speaking.
 *
 * Check-in only when the answer still looks unfinished after the full hesitant
 * hold. Clear answers end quickly with end_turn (never check-in).
 */
export function decideEndpoint(input: EndpointDecisionInput): EndpointDecision {
  const config = input.config ?? ENDPOINTING_CONFIG;
  const signals = analyzeHesitation(input.transcript, input.speechDurationMs, config);
  const hesitant = looksIncomplete(signals);
  const targetSilenceMs = targetSilenceMsForTurn(signals, config);

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
      reason: hesitant ? "hesitant_pause_elapsed" : "done_pause_elapsed",
    };
  }

  return {
    shouldEnd: false,
    action: "hold",
    targetSilenceMs,
    hesitant,
    signals,
    reason: hesitant ? "holding_for_hesitation" : "holding_for_done_pause",
  };
}
