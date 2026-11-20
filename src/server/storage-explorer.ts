import "server-only";
/**
 * Stored-media explorer for the super-admin panel.
 *
 * The server disk is the source of truth: every object under `orgs/...` is listed with
 * its real size, then enriched with candidate / session / project info from the database.
 * Objects are grouped into ONE entry per person (org + project + email), even when
 * several physical folders exist for them (re-invites, older naming), so the admin sees
 * a single "candidate file" and can merge the physical duplicates with one click.
 */
import type { Context } from "@/server/context";
import {
  listAllObjects,
  type StorageObjectMeta,
} from "@/lib/storage";
import {
  candidateFolderSlug,
  candidateMediaPrefix,
  normalizeEmail,
  parseMediaKey,
} from "@/lib/storage-paths";

type Db = Context["supabase"];

export type StoredCategory = "recording" | "screenshot" | "resume" | "raw";

export type StoredFileItem = {
  id: string;
  key: string;
  name: string;
  category: StoredCategory;
  contentType?: string;
  size: number;
  createdAt?: string;
  signedUrl: string;
  folderPrefix?: string;
  candidateName?: string;
  candidateEmail?: string;
  candidateId?: string;
  sessionId?: string;
  interviewTitle?: string;
  interviewId?: string;
  projectName?: string;
  projectId?: string;
  organizationName?: string;
  organizationId?: string;
};

type FolderInfo = {
  candidateId?: string;
  candidateName?: string;
  candidateEmail?: string;
  sessionId?: string;
  interviewId?: string;
  interviewTitle?: string;
  linked: boolean;
};

export type StorageSnapshot = {
  at: number;
  /** Every object in the bucket (for the true "used" figure). */
  bucketObjects: number;
  bucketBytes: number;
  /** Objects under orgs/ with parsed + enriched metadata. */
  items: StoredFileItem[];
  orgNames: Map<string, string>;
  projects: Map<string, { name: string; organizationId: string }>;
};

const TTL_MS = 20_000;
let cached: { snap: StorageSnapshot; at: number } | null = null;

export function invalidateStorageSnapshot() {
  cached = null;
}

const CONTENT_TYPES: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "audio/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function contentTypeFor(name: string): string | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? CONTENT_TYPES[ext] : undefined;
}

function nameFromSlug(slug: string): string {
  return slug.replace(/_[0-9a-f]{8}$/i, "").replace(/_/g, " ").trim() || slug;
}

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  max = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; from < max; from += size) {
    const { data } = await page(from, from + size - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

export async function getStorageSnapshot(
  supabase: Db,
  opts: { fresh?: boolean } = {},
): Promise<StorageSnapshot> {
  if (!opts.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.snap;

  const [objects, orgRows, projectRows, interviewRows] = await Promise.all([
    listAllObjects(""),
    supabase.from("organizations").select("id, name"),
    supabase.from("projects").select("id, name, organizationId"),
    fetchAll<{ id: string; title: string | null; projectId: string }>((from, to) =>
      supabase.from("interviews").select("id, title, projectId").range(from, to),
    ),
  ]);

  const orgNames = new Map<string, string>(
    (orgRows.data ?? []).map((o) => [o.id as string, o.name as string]),
  );
  const projects = new Map(
    (projectRows.data ?? []).map((p) => [
      p.id as string,
      { name: p.name as string, organizationId: p.organizationId as string },
    ]),
  );
  const interviews = new Map(interviewRows.map((i) => [i.id, i]));

  const [candidates, sessions] = await Promise.all([
    fetchAll<{
      id: string;
      name: string | null;
      email: string | null;
      interviewId: string;
      sessionId: string | null;
    }>((from, to) =>
      supabase.from("candidates").select("id, name, email, interviewId, sessionId").range(from, to),
    ),
    fetchAll<{
      id: string;
      interviewId: string;
      participantName: string | null;
      participantEmail: string | null;
      mediaStoragePrefix: string | null;
    }>((from, to) =>
      supabase
        .from("sessions")
        .select("id, interviewId, participantName, participantEmail, mediaStoragePrefix")
        .not("mediaStoragePrefix", "is", null)
        .range(from, to),
    ),
  ]);

  // folder prefix -> who it belongs to. Covers new (email) slugs, legacy id slugs and
  // the session-{id} fallback so old folders still resolve to their candidate.
  const folderInfo = new Map<string, FolderInfo>();
  const put = (prefix: string, info: FolderInfo) => {
    const prev = folderInfo.get(prefix);
    if (!prev || (!prev.candidateEmail && info.candidateEmail)) folderInfo.set(prefix, info);
  };
  const orgOfInterview = (interviewId: string) => {
    const inv = interviews.get(interviewId);
    const proj = inv ? projects.get(inv.projectId) : undefined;
    return inv && proj ? { inv, projectId: inv.projectId, orgId: proj.organizationId } : null;
  };
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  for (const c of candidates) {
    const ctx = orgOfInterview(c.interviewId);
    if (!ctx) continue;
    const info: FolderInfo = {
      candidateId: c.id,
      candidateName: c.name ?? undefined,
      candidateEmail: c.email ?? undefined,
      sessionId: c.sessionId ?? undefined,
      interviewId: c.interviewId,
      interviewTitle: ctx.inv.title ?? undefined,
      linked: true,
    };
    const base = { orgId: ctx.orgId, projectId: ctx.projectId, candidateId: c.id, candidateName: c.name };
    put(candidateMediaPrefix({ ...base, candidateEmail: c.email }), info);
    put(candidateMediaPrefix(base), info);
    const sess = c.sessionId ? sessionById.get(c.sessionId) : undefined;
    if (sess?.mediaStoragePrefix) put(sess.mediaStoragePrefix, info);
  }
  for (const s of sessions) {
    const ctx = orgOfInterview(s.interviewId);
    if (!ctx) continue;
    const info: FolderInfo = {
      candidateName: s.participantName ?? undefined,
      candidateEmail: s.participantEmail ?? undefined,
      sessionId: s.id,
      interviewId: s.interviewId,
      interviewTitle: ctx.inv.title ?? undefined,
      linked: true,
    };
    if (s.mediaStoragePrefix) put(s.mediaStoragePrefix, info);
    put(
      candidateMediaPrefix({
        orgId: ctx.orgId,
        projectId: ctx.projectId,
        candidateId: `session-${s.id}`,
        candidateName: s.participantName,
        candidateEmail: s.participantEmail,
      }),
      info,
    );
  }

  let bucketBytes = 0;
  const items: StoredFileItem[] = [];
  for (const obj of objects) {
    bucketBytes += obj.size;
    if (!obj.key.startsWith("orgs/")) continue;
    const parsed = parseMediaKey(obj.key);
    const proj = parsed.projectId ? projects.get(parsed.projectId) : undefined;
    const info = parsed.folderPrefix ? folderInfo.get(parsed.folderPrefix) : undefined;
    const category: StoredCategory =
      parsed.kind === "recordings"
        ? "recording"
        : parsed.kind === "images"
          ? "screenshot"
          : parsed.kind === "CV"
            ? "resume"
            : "raw";
    items.push({
      id: obj.key,
      key: obj.key,
      name: parsed.fileName,
      category,
      contentType: contentTypeFor(parsed.fileName),
      size: obj.size,
      createdAt: obj.lastModified,
      signedUrl: "",
      folderPrefix: parsed.folderPrefix,
      candidateName:
        info?.candidateName || (parsed.folderSlug ? nameFromSlug(parsed.folderSlug) : undefined),
      candidateEmail: info?.candidateEmail,
      candidateId: info?.candidateId,
      sessionId: info?.sessionId,
      interviewId: info?.interviewId,
      interviewTitle: info?.interviewTitle,
      projectId: parsed.projectId,
      projectName: proj?.name,
      organizationId: parsed.orgId ?? proj?.organizationId,
      organizationName: parsed.orgId ? orgNames.get(parsed.orgId) : undefined,
    });
  }

  const snap: StorageSnapshot = {
    at: Date.now(),
    bucketObjects: objects.length,
    bucketBytes,
    items,
    orgNames,
    projects,
  };
  cached = { snap, at: Date.now() };
  return snap;
}

export type CandidateGroup = {
  /** Stable key: org|project|email, or the physical folder when no email is known. */
  groupKey: string;
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
  organizationId?: string;
  organizationName?: string;
  projectId?: string;
  projectName?: string;
  /** Canonical folder name & full prefix the group should live in. */
  folderSlug: string;
  folderPath: string;
  /** Every physical folder currently holding this person's files. */
  folderPaths: string[];
  duplicateFolders: number;
  linked: boolean;
  recordings: StoredFileItem[];
  images: StoredFileItem[];
  cv: StoredFileItem[];
  raw: StoredFileItem[];
  totalFiles: number;
  totalSizeBytes: number;
  recordingsBytes: number;
  imagesBytes: number;
  cvBytes: number;
  rawBytes: number;
  latestActivity?: string;
};

/** Group items into one entry per person. */
export function groupByCandidate(items: StoredFileItem[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup & { _byFolder: Map<string, number> }>();

  for (const item of items) {
    const email = normalizeEmail(item.candidateEmail);
    const physical = item.folderPrefix ?? `${item.organizationId ?? "-"}/unassigned`;
    const groupKey =
      email && item.organizationId && item.projectId
        ? `${item.organizationId}|${item.projectId}|${email}`
        : physical;

    let g = groups.get(groupKey);
    if (!g) {
      g = {
        groupKey,
        candidateId: item.candidateId ?? groupKey,
        candidateName: item.candidateName || "Unassigned Assets",
        candidateEmail: item.candidateEmail,
        organizationId: item.organizationId,
        organizationName: item.organizationName,
        projectId: item.projectId,
        projectName: item.projectName,
        folderSlug: physical.split("/").pop() || physical,
        folderPath: physical,
        folderPaths: [],
        duplicateFolders: 0,
        linked: !!(item.candidateId || item.sessionId),
        recordings: [],
        images: [],
        cv: [],
        raw: [],
        totalFiles: 0,
        totalSizeBytes: 0,
        recordingsBytes: 0,
        imagesBytes: 0,
        cvBytes: 0,
        rawBytes: 0,
        latestActivity: item.createdAt,
        _byFolder: new Map(),
      };
      groups.set(groupKey, g);
    }

    g._byFolder.set(physical, (g._byFolder.get(physical) ?? 0) + 1);
    if (!g.folderPaths.includes(physical)) g.folderPaths.push(physical);
    if (item.candidateId && !g.linked) g.linked = true;
    if (item.candidateId && g.candidateId === groupKey) g.candidateId = item.candidateId;
    if (item.createdAt && (!g.latestActivity || item.createdAt > g.latestActivity)) {
      g.latestActivity = item.createdAt;
    }
    g.totalFiles += 1;
    g.totalSizeBytes += item.size;
    if (item.category === "recording") {
      g.recordings.push(item);
      g.recordingsBytes += item.size;
    } else if (item.category === "screenshot") {
      g.images.push(item);
      g.imagesBytes += item.size;
    } else if (item.category === "resume") {
      g.cv.push(item);
      g.cvBytes += item.size;
    } else {
      g.raw.push(item);
      g.rawBytes += item.size;
    }
  }

  const out: CandidateGroup[] = [];
  for (const g of Array.from(groups.values())) {
    // Canonical folder: email-based slug when we know the email, else the busiest physical folder.
    const email = normalizeEmail(g.candidateEmail);
    if (email && g.organizationId && g.projectId) {
      const slug = candidateFolderSlug({
        candidateId: g.candidateId,
        candidateName: g.candidateName,
        candidateEmail: email,
      });
      g.folderSlug = slug;
      g.folderPath = `orgs/${g.organizationId}/projects/${g.projectId}/candidates/${slug}`;
    } else {
      const busiest = Array.from(g._byFolder.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (busiest) {
        g.folderPath = busiest;
        g.folderSlug = busiest.split("/").pop() || busiest;
      }
    }
    g.duplicateFolders = Math.max(0, g.folderPaths.filter((p) => p !== g.folderPath).length);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _byFolder, ...rest } = g;
    out.push(rest);
  }
  return out.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes);
}

export type ObjectScope = { organizationId?: string; projectId?: string };

export function filterItems(snap: StorageSnapshot, scope: ObjectScope): StoredFileItem[] {
  return snap.items.filter((i) => {
    if (scope.organizationId && i.organizationId !== scope.organizationId) return false;
    if (scope.projectId && i.projectId !== scope.projectId) return false;
    return true;
  });
}

export function sumBytes(list: { size: number }[]): number {
  return list.reduce((n, o) => n + o.size, 0);
}

/** Bytes + objects under any of the given prefixes (from the cached listing). */
export async function measurePrefixes(
  prefixes: string[],
): Promise<{ objects: number; bytes: number }> {
  let objects = 0;
  let bytes = 0;
  const seen = new Set<string>();
  const lists: StorageObjectMeta[][] = await Promise.all(prefixes.map((p) => listAllObjects(p)));
  for (const list of lists) {
    for (const o of list) {
      if (seen.has(o.key)) continue;
      seen.add(o.key);
      objects += 1;
      bytes += o.size;
    }
  }
  return { objects, bytes };
}
