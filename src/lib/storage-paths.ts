/**
 * Object-key layout for media on the server disk:
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
  let safe = opts.fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".");
  if (isReservedObjectName(safe)) safe = `${safe}_`;

  // Normalize folder kinds to clean standard: recordings, images, CV
  let normalizedKind: string = opts.kind;
  if (normalizedKind === "screenshots") normalizedKind = "images";
  if (normalizedKind === "cv") normalizedKind = "CV";

  const base = opts.prefix?.replace(/\/+$/, "") || candidateMediaPrefix(opts);
  return `${base}/${normalizedKind}/${safe}`;
}

/**
 * Names the local storage layer treats as internal (content-type sidecars and
 * in-flight atomic temp files): listing, quota accounting and prefix deletion
 * skip them, so user content must never be stored under such a name.
 */
export function isReservedObjectName(name: string): boolean {
  return /\.meta$/i.test(name) || /\.part-\d+-\d+$/.test(name);
}

const UPLOAD_EXTS = {
  recording: ["webm", "m4a", "mp4", "ogg"],
  screenshot: ["jpg", "jpeg", "png", "webp"],
} as const;

/**
 * Candidate media file name: sanitized, max 120 chars, ending in an allowlisted
 * extension for the upload type. Anything else gets the server fallback name.
 */
export function mediaUploadFileName(
  name: string | null | undefined,
  type: "recording" | "screenshot",
  fallback: string,
): string {
  const safe = (name ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, ".");
  const ext = safe.includes(".") ? safe.slice(safe.lastIndexOf(".") + 1).toLowerCase() : "";
  const ok =
    safe.length > 0 &&
    safe.length <= 120 &&
    !safe.startsWith(".") &&
    (UPLOAD_EXTS[type] as readonly string[]).includes(ext) &&
    !isReservedObjectName(safe);
  return ok ? safe : fallback;
}

const CONTENT_TYPES: Record<string, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Stored content type comes from the (allowlisted) extension, never the client. */
export function mediaContentType(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Magic bytes are an audio container for audio names and an image for image
 * names (whole recordings and images only; parts are raw slices). Browsers may
 * pick a different container than the name suggests (e.g. Ogg named .m4a), so
 * any container of the same family is accepted.
 */
export function matchesMediaSignature(buf: Uint8Array, fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => buf[offset + i] === b);
  const ascii = (offset: number, s: string) => at(offset, Array.from(s, (c) => c.charCodeAt(0)));
  const audio = at(0, [0x1a, 0x45, 0xdf, 0xa3]) || ascii(4, "ftyp") || ascii(0, "OggS");
  const image =
    at(0, [0xff, 0xd8, 0xff]) ||
    at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    (ascii(0, "RIFF") && ascii(8, "WEBP"));
  if ((UPLOAD_EXTS.recording as readonly string[]).includes(ext)) return audio;
  if ((UPLOAD_EXTS.screenshot as readonly string[]).includes(ext)) return image;
  return false;
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
