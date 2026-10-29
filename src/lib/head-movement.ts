/**
 * Pure logic for Head Movement Detection (anti-cheating).
 * Shared by the browser detector (frame classification + hold/cooldown)
 * and the server (violation counting + disqualification).
 */

export const MAX_HEAD_VIOLATIONS = 3; // 1st & 2nd = warning, 3rd = disqualify

export type HeadFrameState = "ok" | "looking_away" | "no_face" | "multiple_faces";

export interface HeadMovementThresholds {
  yawDeg: number;
  pitchDeg: number;
  holdMs: number;
  noFaceHoldMs: number;
  cooldownMs: number;
}

export const DEFAULT_HEAD_THRESHOLDS: HeadMovementThresholds = {
  yawDeg: 30,
  pitchDeg: 25,
  holdMs: 2000,
  noFaceHoldMs: 3000,
  cooldownMs: 6000,
};

/** Yaw/pitch (degrees) from MediaPipe's 4x4 column-major facial transformation matrix. */
export function matrixToYawPitch(m: ArrayLike<number>): { yaw: number; pitch: number } {
  // r[row][col] = m[col * 4 + row]
  const r20 = m[2];
  const r21 = m[6];
  const r22 = m[10];
  const yaw = Math.asin(Math.max(-1, Math.min(1, -r20))) * (180 / Math.PI);
  const pitch = Math.atan2(r21, r22) * (180 / Math.PI);
  return { yaw, pitch };
}

export function classifyFrame(
  faces: { yaw: number; pitch: number }[],
  t: HeadMovementThresholds = DEFAULT_HEAD_THRESHOLDS,
): HeadFrameState {
  if (faces.length === 0) return "no_face";
  if (faces.length > 1) return "multiple_faces";
  const { yaw, pitch } = faces[0];
  if (Math.abs(yaw) > t.yawDeg || Math.abs(pitch) > t.pitchDeg) return "looking_away";
  return "ok";
}

export const HEAD_STATE_LABEL: Record<Exclude<HeadFrameState, "ok">, string> = {
  looking_away: "Looking away from screen",
  no_face: "Face not visible",
  multiple_faces: "Multiple faces detected",
};

/**
 * Turns a stream of per-frame states into discrete violations: a bad state
 * must persist for holdMs, and violations are separated by cooldownMs.
 */
export class HeadMovementMonitor {
  private badState: HeadFrameState = "ok";
  private badSince: number | null = null;
  private lastViolationAt = -Infinity;

  constructor(private t: HeadMovementThresholds = DEFAULT_HEAD_THRESHOLDS) {}

  update(state: HeadFrameState, now: number): Exclude<HeadFrameState, "ok"> | null {
    if (state === "ok") {
      this.badState = "ok";
      this.badSince = null;
      return null;
    }
    if (state !== this.badState || this.badSince === null) {
      this.badState = state;
      this.badSince = now;
    }
    const hold = state === "no_face" ? this.t.noFaceHoldMs : this.t.holdMs;
    if (now - this.badSince >= hold && now - this.lastViolationAt >= this.t.cooldownMs) {
      this.lastViolationAt = now;
      this.badSince = now; // must persist another full hold to count again
      return state;
    }
    return null;
  }
}

export interface LoggedViolation {
  type: string;
  timestamp: number;
  detail?: string;
  imageUrl?: string;
  imagePath?: string;
}

export function countHeadViolations(log: unknown[]): number {
  return log.filter((v) => (v as { type?: string })?.type === "head_movement").length;
}

/** Server-side: append a violation and decide whether the session is disqualified. */
export function applyAntiCheatingViolation(prevLog: unknown[], violation: LoggedViolation) {
  const log = [...prevLog, violation];
  const headViolations = countHeadViolations(log);
  const disqualify = violation.type === "head_movement" && headViolations >= MAX_HEAD_VIOLATIONS;
  return { log, headViolations, disqualify };
}

export function headWarningMessage(count: number): string {
  const warnings = MAX_HEAD_VIOLATIONS - 1;
  return `Warning ${Math.min(count, warnings)} of ${warnings}: please keep your face toward the screen`;
}
