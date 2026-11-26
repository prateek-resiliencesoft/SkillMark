/**
 * Back-to-back interviewer turns: after the interviewer has spoken, the model
 * may only speak again when (a) the candidate said or did something (a real
 * speech turn, even a complaint), or (b) the relay itself asked for it with a
 * cue (silence ladder, reconnect, no-answer, check-in …), or (c) it is the
 * continuation that asks the next question after an ACCEPTED question change.
 * Anything else (a rejected tool call's follow-up, a noise-triggered turn, a
 * model auto-continue) is a second interviewer turn with no candidate answer
 * in between and is suppressed. Pure and unit-tested.
 */
export class TurnGate {
  private allowances = 0;
  private candidateSignal = false;
  private open = false;
  private suppressing = false;

  /** The candidate spoke / was transcribed / opened or closed a speech turn. */
  candidateTurn() {
    this.candidateSignal = true;
  }

  /** The relay asked the model to speak (cue, reconnect, silence prompt, system say-aloud, accepted move…). */
  cue() {
    this.allowances += 1;
  }

  /**
   * A model output chunk arrived. Returns true when it may be delivered.
   * The first chunk of a turn decides for the whole turn.
   */
  modelOutput(): boolean {
    if (this.suppressing) return false;
    if (this.open) return true;
    if (this.candidateSignal || this.allowances > 0) {
      // One reply per permission: opening a turn uses up everything pending.
      this.candidateSignal = false;
      this.allowances = 0;
      this.open = true;
      return true;
    }
    this.suppressing = true;
    return false;
  }

  /** The model's turn ended (turnComplete / generationComplete / interrupted). Returns true if it had been suppressed. */
  modelTurnEnded(): boolean {
    const was = this.suppressing;
    this.open = false;
    this.suppressing = false;
    return was;
  }

  /** Would a model turn starting now be allowed? (A tool call can arrive before any output.) */
  canSpeak(): boolean {
    return this.open || this.candidateSignal || this.allowances > 0;
  }

  get isSuppressing() {
    return this.suppressing;
  }

  /** A model turn is being delivered right now. */
  get isOpen() {
    return this.open;
  }

  /**
   * The relay rejected the model's tool call. Gemini always speaks after a
   * tool response; that turn must not reach the candidate (it read the
   * rejection aloud, or re-asked the question). Only NEW candidate speech or a
   * relay cue may open the next turn. Suppression starts before the first
   * chunk, so no reply is ever cut mid-sentence.
   */
  rejected() {
    this.candidateSignal = false;
    this.allowances = 0;
  }

  /** Forget stale permissions (new connection, or the browser reset). */
  reset() {
    this.allowances = 0;
    this.candidateSignal = false;
    this.open = false;
    this.suppressing = false;
  }
}
