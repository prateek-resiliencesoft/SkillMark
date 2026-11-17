/**
 * Active liveness prompts at random times. A pre-recorded loop can't respond
 * on cue, and real-time face swaps tend to keep rendering a face over a hand
 * (so "cover your face" still sees a face) or break on head turns.
 */

export type LivenessKind = "turn_head" | "cover_face" | "smile";

export const LIVENESS_PROMPT: Record<LivenessKind, string> = {
  turn_head: "Quick check: turn your head to one side, then back to the screen.",
  cover_face: "Quick check: cover your whole face with your hand for a second.",
  smile: "Quick check: please give us a smile.",
};

export interface LivenessFrame {
  t: number;
  faces: number;
  yaw: number | null;
  smile: number | null;
}

export const LIVENESS_TIMEOUT_MS = 10_000;

export class LivenessChallenge {
  private turned = false;
  private noFaceSince: number | null = null;
  private smileFrames = 0;

  constructor(
    readonly kind: LivenessKind,
    readonly startedAt: number,
    private timeoutMs = LIVENESS_TIMEOUT_MS,
  ) {}

  update(f: LivenessFrame): "pass" | "fail" | null {
    if (this.check(f)) return "pass";
    return f.t - this.startedAt >= this.timeoutMs ? "fail" : null;
  }

  private check(f: LivenessFrame): boolean {
    switch (this.kind) {
      case "turn_head": {
        if (f.faces !== 1 || f.yaw === null) return false;
        if (Math.abs(f.yaw) >= 20) this.turned = true;
        return this.turned && Math.abs(f.yaw) < 10;
      }
      case "cover_face": {
        if (f.faces > 0) { this.noFaceSince = null; return false; }
        if (this.noFaceSince === null) this.noFaceSince = f.t;
        return f.t - this.noFaceSince >= 600;
      }
      case "smile": {
        this.smileFrames = f.faces === 1 && (f.smile ?? 0) >= 0.5 ? this.smileFrames + 1 : 0;
        return this.smileFrames >= 2;
      }
    }
  }
}

/** Two prompts, 2–12 minutes in, at least 2 minutes apart, different kinds. */
export function pickLivenessSchedule(rand: () => number = Math.random): { atMs: number; kind: LivenessKind }[] {
  const kinds: LivenessKind[] = ["turn_head", "cover_face", "smile"];
  const first = kinds.splice(Math.floor(rand() * kinds.length), 1)[0];
  const second = kinds[Math.floor(rand() * kinds.length)];
  const a = 120_000 + rand() * 300_000;
  const b = a + 120_000 + rand() * 300_000;
  return [{ atMs: a, kind: first }, { atMs: b, kind: second }];
}
