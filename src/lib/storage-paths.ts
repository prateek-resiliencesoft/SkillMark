/**
 * Object-key layout for media (local disk or S3/Backblaze B2):
 *   orgs/{orgId}/projects/{projectId}/candidates/{candidateNameFolder}/{kind}/{file}
 *
 * Folders per candidate:
 *   - recordings/  (audio & video recordings)
 *   - images/      (proctoring screenshots and webcam frames)
 *   - CV/          (candidate resume & application documents)
 *
 * One folder per PERSON: when an email is known the folder id is derived from
 * the (normalised) email, so re-invites / repeat applications of the same
 * person land in the same folder instead of one folder per candidate row.
 * Without an email we fall back to the candidate (or session) id.
 */
import { createHash } from "crypto";

export type MediaKind =
  | "recordings"
  | "images"
  | "CV"
  | "screenshots"
  | "cv"
  | "other";

/** Sanitize candidate or entity name into a clean, filesystem-safe folder name */
export function sanitizeFolderName(name?: string | null): string {
  if (!name || !name.trim()) return "";
  return name
    .trim()
    .replace(/[^\w\s-]/g, "") // remove punctuation and special characters
    .replace(/\s+/g, "_")      // replace whitespace with underscores
    .slice(0, 40);             // safe folder length
}

export function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

/** Short stable id for a person: hash of email when known, else the id. */
export function candidateShortId(opts: {
  candidateId: string;
  candidateEmail?: string | null;
}): string {
  const email = normalizeEmail(opts.candidateEmail);
  if (email) return createHash("sha1").update(email).digest("hex").slice(0, 8);
  const rawId = opts.candidateId.replace(/^session-/, "");
  return rawId.includes("-") ? rawId.split("-")[0] : rawId.slice(0, 8);
}

/**
 * Builds candidate folder slug: e.g. "John_Doe_a1b2c3d4" or fallback to candidateId.
 * Pass `candidateEmail` so every candidate row / session of the same person
 * resolves to the same folder.
 */
export function candidateFolderSlug(opts: {
  candidateId: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
}): string {
  const cleanName = sanitizeFolderName(opts.candidateName);
  const hasEmail = !!normalizeEmail(opts.candidateEmail);
  const shortId = candidateShortId(opts);
  if (cleanName) return `${cleanName}_${shortId}`;
  if (hasEmail) return `candidate_${shortId}`;
  return opts.candidateId;
}

/** CV object name, prefixed with the candidate row id so merged folders never overwrite each other. */
export function cvObjectName(candidateId: string, originalName: string, index = 0): string {
  return `${candidateId.split("-")[0].slice(0, 8)}-${index}-${originalName}`;
}

export function candidateMediaPrefix(opts: {
  orgId: string;
  projectId: string;
  candidateId: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
}): string {
  const folder = candidateFolderSlug({
    candidateId: opts.candidateId,
    candidateName: opts.candidateName,
    candidateEmail: opts.candidateEmail,
  });
  return `orgs/${opts.orgId}/projects/${opts.projectId}/candidates/${folder}`;
}

export function mediaObjectKey(opts: {
  orgId: string;
  projectId: string;
  candidateId: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
  kind: MediaKind;
  fileName: string;
  /** Use an already-assigned folder (e.g. sessions.mediaStoragePrefix) instead of recomputing it. */
  prefix?: string | null;
}): string {
  const safe = opts.fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".");

  // Normalize folder kinds to clean standard: recordings, images, CV
  let normalizedKind: string = opts.kind;
  if (normalizedKind === "screenshots") normalizedKind = "images";
  if (normalizedKind === "cv") normalizedKind = "CV";

  const base = opts.prefix?.replace(/\/+$/, "") || candidateMediaPrefix(opts);
  return `${base}/${normalizedKind}/${safe}`;
}

/** Split an object key into its parts: orgs/{org}/projects/{project}/candidates/{slug}/{kind}/{file} */
export function parseMediaKey(key: string): {
  orgId?: string;
  projectId?: string;
  folderSlug?: string;
  folderPrefix?: string;
  kind?: "recordings" | "images" | "CV" | "other";
  fileName: string;
} {
  const parts = key.replace(/^\/+/, "").split("/");
  const fileName = parts[parts.length - 1] || key;
  if (parts[0] !== "orgs" || parts[2] !== "projects" || parts[4] !== "candidates" || parts.length < 7) {
    return {
      orgId: parts[0] === "orgs" ? parts[1] : undefined,
      projectId: parts[0] === "orgs" && parts[2] === "projects" ? parts[3] : undefined,
      fileName,
    };
  }
  const kindSeg = parts.length >= 8 ? parts[6] : undefined;
  const kind =
    kindSeg === "recordings" || kindSeg === "images" || kindSeg === "CV"
      ? kindSeg
      : "other";
  return {
    orgId: parts[1],
    projectId: parts[3],
    folderSlug: parts[5],
    folderPrefix: parts.slice(0, 6).join("/"),
    kind,
    fileName,
  };
}

/** Logical bucket name used by older callers (recordings/screenshots/…). */
export function kindFromLogicalBucket(bucket: string): MediaKind {
  if (bucket === "recordings") return "recordings";
  if (bucket === "screenshots" || bucket === "images") return "images";
  if (bucket === "cv" || bucket === "CV") return "CV";
  return "other";
}
