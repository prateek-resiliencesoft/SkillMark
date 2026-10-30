/**
 * Object-key layout for media (local disk or S3/B2):
 *   orgs/{orgId}/projects/{projectId}/candidates/{candidateId}/{kind}/{file}
 *
 * kind: recordings | screenshots | cv | images | other
 */
export type MediaKind = "recordings" | "screenshots" | "cv" | "images" | "other";

export function candidateMediaPrefix(opts: {
  orgId: string;
  projectId: string;
  candidateId: string;
}): string {
  return `orgs/${opts.orgId}/projects/${opts.projectId}/candidates/${opts.candidateId}`;
}

export function mediaObjectKey(opts: {
  orgId: string;
  projectId: string;
  candidateId: string;
  kind: MediaKind;
  fileName: string;
}): string {
  const safe = opts.fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".");
  return `${candidateMediaPrefix(opts)}/${opts.kind}/${safe}`;
}

/** Logical bucket name used by older callers (recordings/screenshots/…). */
export function kindFromLogicalBucket(bucket: string): MediaKind {
  if (bucket === "recordings" || bucket === "screenshots" || bucket === "cv" || bucket === "images") {
    return bucket;
  }
  return "other";
}
