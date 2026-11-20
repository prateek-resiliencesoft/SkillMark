/**
 * Storage cap rules (pure, unit-tested). The cap is the "maximum storage"
 * a super admin sets in the platform panel (platform_settings.storageQuota).
 *
 *  - 80% / 95%: warning levels shown in the super-admin panel.
 *  - 100%: new uploads are refused, except media for an interview that is
 *    running right now (losing a live candidate's recording is worse than
 *    going slightly over the cap), up to a bounded overage.
 *  - The physical disk keeps a safety floor no upload may eat into.
 */
export type StorageCapLevel = "ok" | "warn80" | "warn95" | "full";

export const DISK_SAFETY_FLOOR_BYTES = 2 * 1024 ** 3;

const RANK: Record<StorageCapLevel, number> = { ok: 0, warn80: 1, warn95: 2, full: 3 };

export function capLevelRank(level: StorageCapLevel): number {
  return RANK[level];
}

export function storageCapLevel(usedBytes: number, quotaBytes: number | null | undefined): StorageCapLevel {
  if (!quotaBytes || quotaBytes <= 0) return "ok";
  const ratio = usedBytes / quotaBytes;
  if (ratio >= 1) return "full";
  if (ratio >= 0.95) return "warn95";
  if (ratio >= 0.8) return "warn80";
  return "ok";
}

export type UploadDecision = { allowed: true } | { allowed: false; reason: "cap" | "disk" };

export function decideUpload(input: {
  usedBytes: number;
  quotaBytes: number | null | undefined;
  incomingBytes: number;
  liveSession: boolean;
  diskFreeBytes: number | null | undefined;
  diskFloorBytes?: number;
}): UploadDecision {
  const floor = input.diskFloorBytes ?? DISK_SAFETY_FLOOR_BYTES;
  if (input.diskFreeBytes != null && input.diskFreeBytes - input.incomingBytes < floor) {
    return { allowed: false, reason: "disk" };
  }
  if (input.quotaBytes && input.quotaBytes > 0) {
    // Live interviews may go past the cap, but only by a bounded overage.
    const limit = input.liveSession ? input.quotaBytes + liveOverageBytes(input.quotaBytes) : input.quotaBytes;
    if (input.usedBytes + input.incomingBytes > limit) return { allowed: false, reason: "cap" };
  }
  return { allowed: true };
}

/** How far past the cap live-interview media may go: 25% of the cap, at least 2 GiB. */
export function liveOverageBytes(quotaBytes: number): number {
  return Math.max(2 * 1024 ** 3, Math.round(quotaBytes * 0.25));
}

/** Per-session candidate upload budget (a 3 h interview is ~1,100 parts + screenshots). */
export const SESSION_UPLOAD_MAX_OBJECTS = 3_000;
export const SESSION_UPLOAD_MAX_BYTES = 1024 ** 3;
const SESSION_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const sessionUploads = new Map<string, { objects: number; bytes: number; at: number }>();

/**
 * Count an upload against the session's budget. Returns an error message when
 * the budget is spent (the upload must be refused), else null. In-process.
 */
export function reserveSessionUpload(sessionId: string, bytes: number, nowMs: number = Date.now()): string | null {
  if (sessionUploads.size > 10_000) {
    sessionUploads.forEach((v, k) => {
      if (nowMs - v.at > SESSION_UPLOAD_TTL_MS) sessionUploads.delete(k);
    });
  }
  const prev = sessionUploads.get(sessionId);
  const cur = prev && nowMs - prev.at <= SESSION_UPLOAD_TTL_MS ? prev : { objects: 0, bytes: 0, at: nowMs };
  if (cur.objects + 1 > SESSION_UPLOAD_MAX_OBJECTS || cur.bytes + bytes > SESSION_UPLOAD_MAX_BYTES) {
    return "Upload limit for this interview reached.";
  }
  sessionUploads.set(sessionId, { objects: cur.objects + 1, bytes: cur.bytes + bytes, at: cur.at });
  return null;
}

/** How long after an interview ends its final recording/screenshots still count as live. */
export const LIVE_FINALIZE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Media of an interview that is running, or that just ended (the final
 * recording upload lands after the session is marked complete).
 */
export function isLiveInterviewUpload(
  session: { status?: string | null; completedAt?: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (session.status === "IN_PROGRESS") return true;
  if (session.status !== "COMPLETED" && session.status !== "DISQUALIFIED") return false;
  const ended = session.completedAt ? Date.parse(session.completedAt) : NaN;
  return Number.isFinite(ended) && nowMs - ended < LIVE_FINALIZE_WINDOW_MS;
}

export const STORAGE_CAP_MESSAGES = {
  cap: "Storage limit reached. Ask the platform admin to raise the storage cap.",
  disk: "The server disk is almost full, so this file could not be saved. Ask the platform admin to free up space.",
} as const;

/** True for an upload error produced by the cap gate (routes answer 507 for it). */
export function isStorageCapError(message: string | null | undefined): boolean {
  return message === STORAGE_CAP_MESSAGES.cap || message === STORAGE_CAP_MESSAGES.disk;
}
