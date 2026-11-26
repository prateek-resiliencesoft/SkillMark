import "server-only";
import { deletePrefixStats, listObjectKeys, objectKey, readFile, statLocalObject, storage } from "@/lib/storage";
import { createLogger } from "@/lib/logger";
import { normalizeRejectTags } from "@/lib/reject-tags";
import { isSafeObjectPath, objectPathFromSignedUrl, pathBelongsToSession } from "@/lib/tenant-storage";
import type { Context } from "@/server/context";

const log = createLogger("media-review");

type Db = Context["supabase"];

const SET_ASIDE_DAYS = 15;

export type MediaReviewAction = "approved" | "declined" | "set_aside";

export type ApplyMediaReviewOptions = {
  /** Only for declined. Default false — keep media files. */
  deleteMedia?: boolean;
  rejectReason?: string | null;
  rejectTags?: string[];
};

type MediaRef = { bucket: "recordings" | "screenshots"; key: string };

const SESSION_MEDIA_COLUMNS =
  "id, mediaStoragePrefix, participantEmail, audioRecordingUrl, audioRecordings, screenshots, antiCheatingLog, interview:interviews!inner(projectId, project:projects!inner(organizationId))";

export type SessionMediaRow = {
  id: string;
  mediaStoragePrefix?: string | null;
  participantEmail?: string | null;
  audioRecordingUrl?: string | null;
  audioRecordings?: unknown;
  screenshots?: unknown;
  antiCheatingLog?: unknown;
  interview?: { projectId?: string | null; project?: { organizationId?: string | null } | null } | null;
};

function refsOf(list: unknown, fields: string[]): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const e of list as unknown[]) {
    if (typeof e === "string") out.push(e);
    else if (e && typeof e === "object") {
      for (const f of fields) {
        const v = (e as Record<string, unknown>)[f];
        if (typeof v === "string" && v) out.push(v);
      }
    }
  }
  return out;
}

function storedRefs(row: SessionMediaRow): MediaRef[] {
  const out: MediaRef[] = [];
  const add = (bucket: MediaRef["bucket"], raw: string) => {
    const key = objectPathFromSignedUrl(bucket, raw);
    if (key) out.push({ bucket, key });
  };
  if (typeof row.audioRecordingUrl === "string" && row.audioRecordingUrl) add("recordings", row.audioRecordingUrl);
  refsOf(row.audioRecordings, ["path", "url"]).forEach((r) => add("recordings", r));
  refsOf(row.screenshots, ["path", "url"]).forEach((r) => add("screenshots", r));
  refsOf(row.antiCheatingLog, ["imagePath", "screenImagePath", "imageUrl", "screenImageUrl"]).forEach((r) =>
    add("screenshots", r),
  );
  return out;
}

/**
 * Objects that belong to this session alone: the media its row references
 * (inside its own folder), plus its recording parts and transcript backups.
 * Candidate folders are shared per person, so a folder is never wiped as a
 * whole unless it is the session's own `session-{id}` folder, and objects a
 * sibling session also references are kept.
 */
export async function sessionOwnedMediaKeys(supabase: Db, row: SessionMediaRow): Promise<MediaRef[]> {
  const orgId = row.interview?.project?.organizationId ?? null;
  const projectId = row.interview?.projectId ?? null;
  if (!orgId || !projectId) return [];
  const scope = { projectId, mediaStoragePrefix: row.mediaStoragePrefix ?? null };
  const sessionId = row.id;
  const owned = new Map<string, MediaRef>();
  for (const ref of storedRefs(row)) {
    if (pathBelongsToSession(ref.key, sessionId, orgId, scope)) owned.set(ref.key, ref);
  }

  const ownFolder = `orgs/${orgId}/projects/${projectId}/candidates/session-${sessionId}`;
  const shared = row.mediaStoragePrefix?.replace(/\/+$/, "");
  const folders = Array.from(new Set([ownFolder, ...(shared && shared !== ownFolder ? [shared] : [])]));
  const sid = sessionId.toLowerCase();
  for (const folder of folders) {
    const keys = await listObjectKeys(`${folder}/`).catch(() => [] as string[]);
    for (const key of keys) {
      const name = key.split("/").pop() ?? "";
      if (folder === ownFolder) {
        owned.set(key, { bucket: "recordings", key });
      } else if (name.startsWith(`part-${sid}-`) || name.startsWith(`transcript-backup-${sid}-`)) {
        owned.set(key, { bucket: "recordings", key });
      } else if (/^transcript-backup-\d+\.json$/.test(name) && (await backupBelongsTo(key, sessionId))) {
        owned.set(key, { bucket: "recordings", key });
      }
    }
  }

  if (shared && shared !== ownFolder) {
    const { data: siblings } = await supabase
      .from("sessions")
      .select("id, audioRecordingUrl, audioRecordings, screenshots, antiCheatingLog")
      .eq("mediaStoragePrefix", row.mediaStoragePrefix as string)
      .neq("id", sessionId);
    for (const s of (siblings ?? []) as SessionMediaRow[]) {
      for (const ref of storedRefs(s)) owned.delete(ref.key);
    }
  }
  return Array.from(owned.values());
}

/**
 * The session's candidate folder when nobody else uses it (no other session
 * points at it, no other candidate row with the same email in the project),
 * so it can be wiped whole (CVs included). Null when shared or unknown.
 */
async function exclusiveCandidateFolder(supabase: Db, row: SessionMediaRow): Promise<string | null> {
  const orgId = row.interview?.project?.organizationId;
  const projectId = row.interview?.projectId;
  const folder = row.mediaStoragePrefix?.replace(/\/+$/, "");
  if (!orgId || !projectId || !folder) return null;
  const parts = folder.split("/");
  if (
    parts.length !== 6 ||
    !isSafeObjectPath(folder) ||
    !folder.startsWith(`orgs/${orgId}/projects/${projectId}/candidates/`)
  ) {
    return null;
  }

  const { data: otherSessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("mediaStoragePrefix", row.mediaStoragePrefix as string)
    .neq("id", row.id)
    .limit(1);
  if ((otherSessions?.length ?? 0) > 0) return null;

  const { data: own } = await supabase.from("candidates").select("id, email").eq("sessionId", row.id);
  const ownIds = (own ?? []).map((c) => c.id as string);
  const email = (((own ?? [])[0]?.email as string | null) || row.participantEmail || "").trim().toLowerCase();
  if (email) {
    const { data: others } = await supabase
      .from("candidates")
      .select("id, interview:interviews!inner(projectId)")
      .ilike("email", email)
      .eq("interview.projectId", projectId)
      .limit(50);
    if ((others ?? []).some((o) => !ownIds.includes(o.id as string))) return null;
  }
  return folder;
}

async function backupBelongsTo(key: string, sessionId: string): Promise<boolean> {
  try {
    const { data } = await readFile("recordings", key);
    if (data.length > 5 * 1024 * 1024) return false;
    return (JSON.parse(data.toString("utf8")) as { sessionId?: unknown })?.sessionId === sessionId;
  } catch {
    return false;
  }
}

/** Remove keys from disk; returns how many objects / bytes were actually there. */
export async function removeMediaRefs(refs: MediaRef[]): Promise<{ objects: number; bytes: number }> {
  let objects = 0;
  let bytes = 0;
  for (const ref of refs) {
    const st = await statLocalObject(objectKey(ref.bucket, ref.key));
    await storage.from(ref.bucket).remove([ref.key]);
    if (st) {
      objects += 1;
      bytes += st.size;
    }
  }
  return { objects, bytes };
}

/**
 * Wipe object-store media for a session. Never deletes DB rows / scores / messages.
 * `_prefix` is accepted for older callers; the session row is the source of truth.
 */
export async function clearSessionMediaStorage(
  supabase: Db,
  sessionId: string,
  _prefix?: string | null,
): Promise<{ cleared: number }> {
  const { data } = await supabase.from("sessions").select(SESSION_MEDIA_COLUMNS).eq("id", sessionId).maybeSingle();

  let cleared = 0;
  if (data) {
    const row = data as unknown as SessionMediaRow;
    const refs = await sessionOwnedMediaKeys(supabase, row);
    cleared = (await removeMediaRefs(refs)).objects;
    const folder = await exclusiveCandidateFolder(supabase, row);
    if (folder) cleared += (await deletePrefixStats(folder)).objects;
    log.info(`Cleared ${cleared} object(s) for session ${sessionId}${folder ? ` (folder ${folder})` : ""}`);
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

/** Drop stored files and the transcript. Keep the row, name, and score. */
export async function archiveSessionData(
  supabase: Db,
  sessionId: string,
  prefix?: string | null,
): Promise<{ cleared: number }> {
  const { cleared } = await clearSessionMediaStorage(supabase, sessionId, prefix);
  await supabase.from("messages").delete().eq("sessionId", sessionId);
  await supabase
    .from("sessions")
    .update({
      dataArchivedAt: new Date().toISOString(),
      summary: null,
      themes: [],
      sentiment: null,
      antiCheatingLog: [],
      activitySegments: [],
      participantMetadata: null,
      currentQuestionId: null,
    })
    .eq("id", sessionId);
  return { cleared };
}

export type StorageScope = { organizationIds: string[]; projectIds?: string[] };

/** Object-store prefixes a retention scope covers (shared by preview + delete). */
export async function resolveScopePrefixes(
  supabase: Db,
  scope: StorageScope,
): Promise<{ prefixes: string[]; projects: { id: string; organizationId: string }[] }> {
  const projectIds = scope.projectIds?.filter(Boolean);
  let projects: { id: string; organizationId: string }[] = [];
  if (projectIds && projectIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("id, organizationId")
      .in("id", projectIds);
    projects = (data ?? []) as { id: string; organizationId: string }[];
  } else if (scope.organizationIds.length > 0) {
    for (let i = 0; i < scope.organizationIds.length; i += 100) {
      const chunk = scope.organizationIds.slice(i, i + 100);
      const { data } = await supabase
        .from("projects")
        .select("id, organizationId")
        .in("organizationId", chunk);
      projects.push(...((data ?? []) as { id: string; organizationId: string }[]));
    }
  }

  const prefixes =
    projectIds && projectIds.length > 0
      ? projects.map((p) => `orgs/${p.organizationId}/projects/${p.id}/`)
      : scope.organizationIds.map((id) => `orgs/${id}/`);
  return { prefixes, projects };
}

/** Delete object-storage files for organizations or projects. Scores and transcripts stay. */
export async function clearStoredMedia(
  supabase: Db,
  scope: StorageScope,
): Promise<{ objects: number; bytes: number; sessions: number }> {
  const { prefixes, projects } = await resolveScopePrefixes(supabase, scope);

  let objects = 0;
  let bytes = 0;
  for (const prefix of prefixes) {
    const r = await deletePrefixStats(prefix);
    objects += r.objects;
    bytes += r.bytes;
  }

  const ids = projects.map((p) => p.id);
  let sessions = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data: interviews } = await supabase
      .from("interviews")
      .select("id")
      .in("projectId", chunk);
    const interviewIds = (interviews ?? []).map((row) => row.id as string);
    for (let j = 0; j < interviewIds.length; j += 100) {
      const interviewChunk = interviewIds.slice(j, j + 100);
      const { data: rows } = await supabase
        .from("sessions")
        .select("id")
        .in("interviewId", interviewChunk)
        .is("mediaClearedAt", null);
      const sessionIds = (rows ?? []).map((row) => row.id as string);
      if (sessionIds.length === 0) continue;
      await supabase
        .from("sessions")
        .update({
          mediaClearedAt: new Date().toISOString(),
          audioRecordingUrl: null,
          screenshots: [],
          audioRecordings: [],
        })
        .in("id", sessionIds);
      sessions += sessionIds.length;
    }
  }

  return { objects, bytes, sessions };
}

export async function applyMediaReview(
  supabase: Db,
  sessionId: string,
  action: MediaReviewAction,
  opts?: ApplyMediaReviewOptions,
): Promise<{ status: MediaReviewAction; mediaExpiresAt: string | null; cleared: number }> {
  const now = new Date();
  const patch: Record<string, unknown> = {
    mediaReviewStatus: action,
    mediaReviewAt: now.toISOString(),
  };

  let cleared = 0;

  if (action === "approved") {
    patch.mediaExpiresAt = null;
    patch.rejectReason = null;
    patch.rejectTags = [];
  } else if (action === "set_aside") {
    const exp = new Date(now.getTime() + SET_ASIDE_DAYS * 24 * 60 * 60 * 1000);
    patch.mediaExpiresAt = exp.toISOString();
  } else if (action === "declined") {
    const reason =
      typeof opts?.rejectReason === "string" && opts.rejectReason.trim()
        ? opts.rejectReason.trim().slice(0, 1000)
        : null;
    const tags = normalizeRejectTags(opts?.rejectTags);
    if (opts?.deleteMedia === true) {
      const result = await clearSessionMediaStorage(supabase, sessionId);
      cleared = result.cleared;
    }
    // clearSessionMediaStorage may have written mediaClearedAt; always set review + remark fields
    await supabase
      .from("sessions")
      .update({
        mediaReviewStatus: "declined",
        mediaReviewAt: now.toISOString(),
        mediaExpiresAt: null,
        rejectReason: reason,
        rejectTags: tags,
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

/** Cron: set-aside past mediaExpiresAt → clear stored files only. */
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
