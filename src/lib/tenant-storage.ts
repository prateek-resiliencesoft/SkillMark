/**
 * Tenant-scoped object paths for local disk storage.
 *
 * Current media writes (see storage-paths.ts):
 *   orgs/<organizationId>/projects/<projectId>/candidates/<candidateId>/…
 *
 * Older helpers still emit:
 *   org/<organizationId>/sessions/<sessionId>/<filename>
 *   org/<organizationId>/applications/<publicId>/…
 *
 * Legacy (still readable):
 *   <sessionId>/<filename>                  — pre-tenant session media
 *   <organizationId>/<publicId>/...         — application files
 *
 * Signed URLs already bind bucket+path via JWT. These helpers stop the app
 * from re-signing another organization's object when building results views.
 */

const ORG_PREFIX = "org/";
const ORGS_PREFIX = "orgs/";

export function normalizeObjectPath(objectPath: string): string {
  return objectPath.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function isDotSegment(seg: string): boolean {
  if (seg === "." || seg === "..") return true;
  if (!seg.includes("%")) return false;
  try {
    const d = decodeURIComponent(seg);
    return d === "." || d === ".." || /[/\\\0]/.test(d);
  } catch {
    return false;
  }
}

/**
 * Object keys are compared as strings, but disk reads resolve them as paths:
 * refuse anything that path resolution could reinterpret.
 */
export function isSafeObjectPath(objectPath: string): boolean {
  if (!objectPath || /[\\\0]/.test(objectPath)) return false;
  return !objectPath.split("/").some(isDotSegment);
}

/** Session media path for new uploads. */
export function tenantSessionObjectPath(
  organizationId: string,
  sessionId: string,
  filename: string,
): string {
  const clean = filename.replace(/^\/+/, "");
  return `${ORG_PREFIX}${organizationId}/sessions/${sessionId}/${clean}`;
}

/** Application attachment path for new uploads. */
export function tenantApplicationObjectPath(
  organizationId: string,
  applicationPublicId: string,
  fieldKey: string,
  filename: string,
): string {
  const clean = filename.replace(/^\/+/, "");
  return `${ORG_PREFIX}${organizationId}/applications/${applicationPublicId}/${fieldKey}/${clean}`;
}

/** True when the path is clearly keyed to this organization. */
export function pathBelongsToOrganization(
  objectPath: string,
  organizationId: string,
): boolean {
  const p = normalizeObjectPath(objectPath);
  if (!organizationId || !isSafeObjectPath(p)) return false;
  return (
    p.startsWith(`${ORGS_PREFIX}${organizationId}/`) ||
    p.startsWith(`${ORG_PREFIX}${organizationId}/`) ||
    p.startsWith(`${organizationId}/`)
  );
}

/** Where this session's media may live under orgs/ (from the sessions row + its interview). */
export type SessionStorageScope = {
  projectId: string | null | undefined;
  mediaStoragePrefix: string | null | undefined;
};

const SESSION_MEDIA_KINDS = new Set(["recordings", "images", "screenshots"]);

/**
 * True when the path may be served for this session.
 * Accepts orgs/ recordings/images in the session's own folder
 * (candidates/session-{sessionId}, or its mediaStoragePrefix when `scope` is
 * given) inside its project, org/ session media, and legacy `sessionId/...`
 * paths. Without `scope`, shared candidate folders are refused.
 */
export function pathBelongsToSession(
  objectPath: string,
  sessionId: string,
  organizationId: string,
  scope?: SessionStorageScope,
): boolean {
  const p = normalizeObjectPath(objectPath);
  if (!sessionId || !organizationId || !isSafeObjectPath(p)) return false;

  // Current layout: orgs/{org}/projects/{project}/candidates/{folder}/{kind}/{file}
  if (p.startsWith(`${ORGS_PREFIX}${organizationId}/`)) {
    const parts = p.split("/");
    if (parts.length < 8 || parts[2] !== "projects" || parts[4] !== "candidates") return false;
    if (scope && (!scope.projectId || parts[3] !== scope.projectId)) return false;
    if (!SESSION_MEDIA_KINDS.has(parts[6])) return false;
    if (parts[5] === `session-${sessionId}`) return true;
    const own = scope?.mediaStoragePrefix ? normalizeObjectPath(scope.mediaStoragePrefix).replace(/\/+$/, "") : "";
    return !!own && parts.slice(0, 6).join("/") === own;
  }
  if (p.startsWith(ORGS_PREFIX)) {
    return false;
  }

  if (p.startsWith(`${ORG_PREFIX}${organizationId}/sessions/${sessionId}/`)) {
    return true;
  }

  // Wrong org under the org/ prefix — never allow.
  if (p.startsWith(ORG_PREFIX) && !p.startsWith(`${ORG_PREFIX}${organizationId}/`)) {
    return false;
  }

  // Legacy application-style org root is not session media.
  if (p.startsWith(`${organizationId}/`) && !p.includes(`/sessions/${sessionId}/`)) {
    return false;
  }

  // Legacy pre-tenant session uploads.
  return p === sessionId || p.startsWith(`${sessionId}/`);
}

/**
 * Pull the storage object path out of a signed URL or bare path.
 * Returns null when the value cannot be interpreted for the given bucket.
 */
export function objectPathFromSignedUrl(
  bucket: string,
  urlOrPath: string,
): string | null {
  const p = extractObjectPath(bucket, urlOrPath);
  return p && isSafeObjectPath(p) ? p : null;
}

function extractObjectPath(bucket: string, urlOrPath: string): string | null {
  const raw = urlOrPath.trim();
  if (!raw) return null;

  // Bare relative object path (no scheme, no /api/files/).
  if (
    !raw.includes("://") &&
    !raw.includes("/api/files/") &&
    !raw.startsWith(`/${bucket}/`)
  ) {
    return normalizeObjectPath(raw.split("?")[0] ?? raw);
  }

  try {
    const u = raw.includes("://")
      ? new URL(raw)
      : new URL(raw, "http://local.invalid");
    const segments = u.pathname.split("/").map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
    const filesIdx = segments.indexOf("files");
    if (filesIdx >= 0 && segments[filesIdx + 1] === bucket) {
      const rest = segments.slice(filesIdx + 2).filter(Boolean);
      // The URL carries the object key; non-orgs keys are `<bucket>/<path>`.
      if (rest.length > 1 && rest[0] === bucket) return rest.slice(1).join("/");
      if (rest.length > 0) return rest.join("/");
    }
    // Other full URLs (…/orgs/…): the key starts at `orgs/`, even when a later
    // folder shares the bucket name (…/recordings/file.webm).
    const orgsIdx = segments.indexOf("orgs");
    if (orgsIdx >= 0 && segments.length > orgsIdx + 1) {
      return segments.slice(orgsIdx).filter(Boolean).join("/");
    }
  } catch {
    // fall through
  }

  const escaped = bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`/${escaped}/(.+?)(?:\\?|$)`));
  if (!match?.[1]) return null;
  try {
    return normalizeObjectPath(decodeURIComponent(match[1]));
  } catch {
    return normalizeObjectPath(match[1]);
  }
}
