import "server-only";
import { createLogger } from "@/lib/logger";
import { deletePrefixStats, listObjectsWithMetadata, storage } from "@/lib/storage";
import { candidateMediaPrefix } from "@/lib/storage-paths";
import type { Context } from "@/server/context";

const log = createLogger("candidate-data-deletion");
type Db = Context["supabase"];

function pathsFrom(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return (list as Array<Record<string, unknown> | string>)
    .map((e) => (typeof e === "string" ? e : typeof e?.path === "string" ? e.path : ""))
    .filter(Boolean);
}

/**
 * Permanently remove one session AND everything that belongs to its candidate:
 * recordings, proctoring images and CV in the bucket, plus the session, messages,
 * candidate row(s) and the form application(s) in the database.
 *
 * Candidate folders are shared per person (same email). When another session or
 * candidate row still uses the folder, only the files that belong to THIS session /
 * candidate are removed, so nobody else's media is touched.
 */
export async function deleteSessionWithData(
  supabase: Db,
  sessionId: string,
): Promise<{ objects: number; bytes: number }> {
  const { data: session } = await supabase
    .from("sessions")
    .select(
      `id, mediaStoragePrefix, audioRecordingUrl, audioRecordings, screenshots, participantName, participantEmail,
       interview:interviews!inner(id, projectId, project:projects!inner(id, organizationId))`,
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { objects: 0, bytes: 0 };

  const interview = session.interview as unknown as {
    projectId: string;
    project: { organizationId: string };
  };
  const orgId = interview.project.organizationId;
  const projectId = interview.projectId;

  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, name, email, profile")
    .eq("sessionId", sessionId);
  const candidateIds = (candidates ?? []).map((c) => c.id as string);
  const primary = candidates?.[0];
  const email = ((primary?.email as string | null) || (session.participantEmail as string | null) || "")
    .trim()
    .toLowerCase();

  // Every object key this session / candidate points to.
  const keys = new Set<string>();
  const add = (k: unknown) => {
    if (typeof k === "string" && k.startsWith("orgs/")) keys.add(k.replace(/^\/+/, ""));
  };
  add(session.audioRecordingUrl);
  pathsFrom(session.audioRecordings).forEach(add);
  pathsFrom(session.screenshots).forEach(add);
  for (const c of candidates ?? []) {
    const profile = c.profile as Record<string, unknown> | null;
    add(profile?.cvPath);
  }
  let applicationIds: string[] = [];
  if (candidateIds.length > 0) {
    const { data: apps } = await supabase
      .from("applications")
      .select("id, files")
      .in("candidateId", candidateIds);
    applicationIds = (apps ?? []).map((a) => a.id as string);
    for (const a of apps ?? []) {
      const files = a.files as Record<string, unknown> | null;
      for (const list of Object.values(files ?? {})) pathsFrom(list).forEach(add);
    }
  }

  const folder =
    (session.mediaStoragePrefix as string | null) ||
    candidateMediaPrefix({
      orgId,
      projectId,
      candidateId: (primary?.id as string | undefined) || `session-${sessionId}`,
      candidateName: (primary?.name as string | undefined) || (session.participantName as string | null),
      candidateEmail: email || null,
    });

  // Is the folder still needed by someone else (another session / candidate row of the same person)?
  let shared = false;
  const { data: otherSessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("mediaStoragePrefix", folder)
    .neq("id", sessionId)
    .limit(1);
  if ((otherSessions?.length ?? 0) > 0) shared = true;
  if (!shared && email) {
    const { data: others } = await supabase
      .from("candidates")
      .select("id, interview:interviews!inner(projectId)")
      .ilike("email", email)
      .eq("interview.projectId", projectId)
      .limit(50);
    shared = (others ?? []).some((o) => !candidateIds.includes(o.id as string));
  }

  let objects = 0;
  let bytes = 0;
  if (!shared) {
    const r = await deletePrefixStats(folder);
    objects += r.objects;
    bytes += r.bytes;
  }
  // Explicit keys (all of them when shared; leftovers/legacy locations otherwise).
  for (const key of Array.from(keys)) {
    if (!shared && key.startsWith(`${folder}/`)) continue;
    const meta = await listObjectsWithMetadata(key, 1).catch(() => []);
    const hit = meta.find((m) => m.key === key);
    await storage.from("files").remove([key]);
    if (hit) {
      objects += 1;
      bytes += hit.size;
    }
  }

  // Database: applications, candidate rows, then the session (messages etc. cascade).
  if (applicationIds.length > 0) {
    await supabase.from("applications").delete().in("id", applicationIds);
  }
  if (candidateIds.length > 0) {
    await supabase.from("candidates").delete().in("id", candidateIds);
  }
  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw new Error(error.message);

  log.info(
    `Deleted session ${sessionId}: ${candidateIds.length} candidate(s), ${applicationIds.length} application(s), ${objects} object(s), ${bytes} bytes${shared ? " (shared folder kept)" : ""}`,
  );
  return { objects, bytes };
}
