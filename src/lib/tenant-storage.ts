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
  return (
    p.startsWith(`${ORGS_PREFIX}${organizationId}/`) ||
    p.startsWith(`${ORG_PREFIX}${organizationId}/`) ||
    p.startsWith(`${organizationId}/`)
  );
}

/**
 * True when the path may be served for this session.
 * Accepts orgs/ media, org/ session media, and legacy `sessionId/...` paths.
 */
export function pathBelongsToSession(
  objectPath: string,
  sessionId: string,
  organizationId: string,
): boolean {
  const p = normalizeObjectPath(objectPath);

  // Current layout: orgs/{org}/projects/.../candidates/{id|session-{sessionId}}/...
  if (p.startsWith(`${ORGS_PREFIX}${organizationId}/`)) {
    return (
      p.includes(`/candidates/session-${sessionId}/`) ||
      p.includes("/candidates/")
    );
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
      if (rest.length > 0) return rest.join("/");
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
