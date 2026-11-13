/**
 * Small helpers for the Gemini voice relay's session health (pure, testable).
 */

/** Send a little silence when Gemini has had no input for this long. */
export const KEEPALIVE_IDLE_MS = 8_000;
/** If the candidate finished and the AI hasn't started replying by then, nudge it. */
export const RESPONSE_WATCHDOG_MS = 7_000;

let cachedSilence: string | null = null;
/** 100 ms of 16 kHz mono PCM16 silence, base64. */
export function silentPcmBase64(): string {
  if (!cachedSilence) cachedSilence = Buffer.alloc(3200).toString("base64");
  return cachedSilence;
}

/**
 * Which Gemini close codes are safe to resume with the session handle.
 * 1011 (internal error) and 1007/1008 policy errors can leave the resumed
 * session stuck, so those reconnect fresh with a recap instead. 1008 "client
 * inactivity" is fine to resume (it was only idle).
 */
export function shouldResumeAfterClose(code: number, reason = ""): boolean {
  if (code === 1011 || code === 1007) return false;
  if (code === 1008 && !/inactivity/i.test(reason)) return false;
  return true;
}

/** If the AI's voice was cut and nobody speaks within this long, have it repeat. */
export const AI_CUT_RESUME_MS = 3_000;
/**
 * Server backstop: an open candidate turn with no voice in the browser's audio
 * for this long is closed (the browser's own guard fires earlier, at 8s).
 */
export const RELAY_TURN_NO_VOICE_MS = 12_000;
/** PCM16 level (as float RMS) treated as voice in browser audio. */
export const RELAY_VOICE_RMS = 0.01;

/** RMS of little-endian PCM16 audio, scaled to 0..1. */
export function pcm16Rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/** What the AI is told to say when the candidate has been silent after a question. */
export function silenceCheckCue(_attempt: number): string {
  return "[SILENCE_CHECK] The participant has been silent for a few seconds after your question. Say only: \"Are you there?\" (nothing else), then wait. Do not repeat the question and do not call any function.";
}

/** What the AI is told when the candidate never answered and we move on. */
export function noAnswerAdvanceCue(nextQuestionNumber: number, questionText: string | null): string {
  if (!questionText) {
    return "[NO_ANSWER] The participant did not answer the last question. Say briefly that you will wrap up, then give a short, polite farewell.";
  }
  return `[NO_ANSWER] The participant did not answer, so we are moving on. The system already moved to question ${nextQuestionNumber}; do NOT call signal_question_change. Say one short line like "Let's move to the next question." and then ask: "${questionText}"`;
}
