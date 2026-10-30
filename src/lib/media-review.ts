import "server-only";
import { deletePrefix } from "@/lib/storage";
import { createLogger } from "@/lib/logger";
import type { Context } from "@/server/context";

const log = createLogger("media-review");

type Db = Context["supabase"];

const SET_ASIDE_DAYS = 15;

export type MediaReviewAction = "approved" | "declined" | "set_aside";

/** Wipe object-store media for a session. Never deletes DB rows / scores / messages. */
export async function clearSessionMediaStorage(
  supabase: Db,
  sessionId: string,
  prefix?: string | null,
): Promise<{ cleared: number }> {
  let mediaPrefix = prefix;
  if (!mediaPrefix) {
    const { data } = await supabase
      .from("sessions")
      .select("mediaStoragePrefix, audioRecordingUrl, screenshots")
      .eq("id", sessionId)
      .maybeSingle();
    mediaPrefix = data?.mediaStoragePrefix ?? null;

    // Fallback: derive from stored screenshot/audio paths
    if (!mediaPrefix && data) {
      const shots = data.screenshots as { path?: string }[] | null;
      const sample = shots?.find((s) => s.path?.startsWith("orgs/"))?.path
        ?? (typeof data.audioRecordingUrl === "string" && data.audioRecordingUrl.startsWith("orgs/")
          ? data.audioRecordingUrl
          : null);
      if (sample) {
        const parts = sample.split("/");
        // orgs/{o}/projects/{p}/candidates/{c}/...
        if (parts.length >= 6) mediaPrefix = parts.slice(0, 6).join("/");
      }
    }
  }

  let cleared = 0;
  if (mediaPrefix) {
    cleared = await deletePrefix(mediaPrefix);
    log.info(`Cleared ${cleared} object(s) under ${mediaPrefix} for session ${sessionId}`);
  }

  await supabase
    .from("sessions")
    .update({
      mediaClearedAt: new Date().toISOString(),
      audioRecordingUrl: null,
      screenshots: [],
      audioRecordings: [],
    })
    .eq("id", sessionId);

  return { cleared };
}

export async function applyMediaReview(
  supabase: Db,
  sessionId: string,
  action: MediaReviewAction,
): Promise<{ status: MediaReviewAction; mediaExpiresAt: string | null; cleared: number }> {
  const now = new Date();
  const patch: Record<string, unknown> = {
    mediaReviewStatus: action,
    mediaReviewAt: now.toISOString(),
  };

  let cleared = 0;

  if (action === "approved") {
    patch.mediaExpiresAt = null;
  } else if (action === "set_aside") {
    const exp = new Date(now.getTime() + SET_ASIDE_DAYS * 24 * 60 * 60 * 1000);
    patch.mediaExpiresAt = exp.toISOString();
  } else if (action === "declined") {
    patch.mediaExpiresAt = null;
    const result = await clearSessionMediaStorage(supabase, sessionId);
    cleared = result.cleared;
    // clearSessionMediaStorage already wrote mediaClearedAt; keep review fields
    await supabase
      .from("sessions")
      .update({
        mediaReviewStatus: "declined",
        mediaReviewAt: now.toISOString(),
        mediaExpiresAt: null,
      })
      .eq("id", sessionId);
    return { status: action, mediaExpiresAt: null, cleared };
  }

  await supabase.from("sessions").update(patch).eq("id", sessionId);
  return {
    status: action,
    mediaExpiresAt: (patch.mediaExpiresAt as string | null) ?? null,
    cleared,
  };
}

/** Cron: set-aside past mediaExpiresAt → clear S3/B2/local only. */
export async function purgeExpiredSetAsideMedia(supabase: Db): Promise<{ sessions: number; objects: number }> {
  const now = new Date().toISOString();
  const { data: rows } = await supabase
    .from("sessions")
    .select("id, mediaStoragePrefix")
    .eq("mediaReviewStatus", "set_aside")
    .is("mediaClearedAt", null)
    .lt("mediaExpiresAt", now)
    .limit(100);

  let objects = 0;
  for (const row of rows ?? []) {
    const r = await clearSessionMediaStorage(supabase, row.id, row.mediaStoragePrefix);
    objects += r.cleared;
  }
  return { sessions: rows?.length ?? 0, objects };
}
