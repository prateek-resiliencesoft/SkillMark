/**
 * Object-key layout for media (local disk or S3/Backblaze B2):
 *   orgs/{orgId}/projects/{projectId}/candidates/{candidateNameFolder}/{kind}/{file}
 *
 * Folders per candidate:
 *   - recordings/  (audio & video recordings)
 *   - images/      (proctoring screenshots and webcam frames)
 *   - CV/          (candidate resume & application documents)
 */
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

/**
 * Builds candidate folder slug: e.g. "John_Doe_a1b2c3d4" or fallback to candidateId
 */
export function candidateFolderSlug(opts: {
  candidateId: string;
  candidateName?: string | null;
}): string {
  const cleanName = sanitizeFolderName(opts.candidateName);
  const rawId = opts.candidateId.replace(/^session-/, "");
  const shortId = rawId.includes("-") ? rawId.split("-")[0] : rawId.slice(0, 8);
  if (cleanName) {
    return `${cleanName}_${shortId}`;
  }
  return opts.candidateId;
}

export function candidateMediaPrefix(opts: {
  orgId: string;
  projectId: string;
  candidateId: string;
  candidateName?: string | null;
}): string {
  const folder = candidateFolderSlug({
    candidateId: opts.candidateId,
    candidateName: opts.candidateName,
  });
  return `orgs/${opts.orgId}/projects/${opts.projectId}/candidates/${folder}`;
}

export function mediaObjectKey(opts: {
  orgId: string;
  projectId: string;
  candidateId: string;
  candidateName?: string | null;
  kind: MediaKind;
  fileName: string;
}): string {
  const safe = opts.fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".");

  // Normalize folder kinds to clean standard: recordings, images, CV
  let normalizedKind: string = opts.kind;
  if (normalizedKind === "screenshots") normalizedKind = "images";
  if (normalizedKind === "cv") normalizedKind = "CV";

  return `${candidateMediaPrefix(opts)}/${normalizedKind}/${safe}`;
}

/** Logical bucket name used by older callers (recordings/screenshots/…). */
export function kindFromLogicalBucket(bucket: string): MediaKind {
  if (bucket === "recordings") return "recordings";
  if (bucket === "screenshots" || bucket === "images") return "images";
  if (bucket === "cv" || bucket === "CV") return "CV";
  return "other";
}
