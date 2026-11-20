import { checkRateLimit } from "@/lib/api-rate-limit";
import { API_KEY_SCOPES, effectiveScopes, hashApiKey, keyHasScope, parseBearerKey, type ApiKeyScope } from "@/lib/api-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserById } from "@/lib/users";
import { filterAccessibleProjectIds } from "@/server/trpc";

export interface ApiKeyAuth {
  userId: string;
  organizationId: string;
  projectIds: string[];
  apiKeyId?: string;
  environment?: "test" | "live";
  scopes?: string[];
  /** Key owner is a VIEWER or the organization is paused: write scopes were stripped. */
  readOnly?: boolean;
}

/**
 * Scope(s) the endpoint needs. `null` only for transports that check a scope
 * per operation themselves (MCP tools); every REST handler must name one.
 */
export type RequiredScope = ApiKeyScope | readonly ApiKeyScope[] | null;

const READ_SCOPES = API_KEY_SCOPES.filter((s) => s.endsWith(":read"));

/** Downgrade a key to what a VIEWER (or a paused org) may do: reads only. */
export function readOnlyScopes(scopes: string[]): string[] {
  const out = new Set<string>();
  for (const s of scopes) {
    if (s === "*") for (const r of READ_SCOPES) out.add(r);
    else if (s.endsWith(":write")) out.add(`${s.slice(0, -":write".length)}:read`);
    else out.add(s);
  }
  return Array.from(out);
}

function missingScope(scopes: string[], required: RequiredScope): ApiKeyScope | null {
  if (required === null) return null;
  const list: readonly ApiKeyScope[] = typeof required === "string" ? [required] : required;
  return list.find((s) => !keyHasScope(scopes, s)) ?? null;
}

export function apiError(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
) {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

export async function validateApiKey(
  request: Request,
  requiredScope: RequiredScope,
): Promise<ApiKeyAuth | Response> {
  const key = parseBearerKey(request.headers.get("authorization"));
  if (!key) {
    return apiError(
      "UNAUTHORIZED",
      "Missing or invalid API key. Use: Authorization: Bearer rsi_live_xxx",
      401,
    );
  }
  const keyHash = hashApiKey(key);

  const { data: apiKey } = await supabaseAdmin
    .from("api_keys")
    .select("id, userId, isActive, expiresAt, revokedAt, environment, scopes, keyPrefix, organizationId")
    .eq("keyHash", keyHash)
    .maybeSingle();

  if (!apiKey || !apiKey.isActive || apiKey.revokedAt) {
    return apiError("UNAUTHORIZED", "Invalid or revoked API key.", 401);
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
    return apiError("UNAUTHORIZED", "API key has expired.", 401);
  }

  const rateLimited = checkRateLimit(`key:${apiKey.id}`);
  if (rateLimited) return rateLimited;

  let scopes = effectiveScopes(apiKey.scopes as string[], apiKey.keyPrefix as string | null);
  const lacking = missingScope(scopes, requiredScope);
  if (lacking) {
    return apiError("FORBIDDEN", `This API key lacks the "${lacking}" permission.`, 403);
  }

  const userId: string = apiKey.userId;
  if (!(await getUserById(userId))) {
    return apiError("UNAUTHORIZED", "The account that owns this API key is paused or deleted.", 401);
  }

  let organizationId: string | null = (apiKey.organizationId as string | null) ?? null;
  let member: { organizationId: string; role: string } | null;
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from("organization_members")
      .select("organizationId, role")
      .eq("userId", userId)
      .eq("organizationId", organizationId)
      .maybeSingle();
    member = data as typeof member;
  } else {
    const { data } = await supabaseAdmin
      .from("organization_members")
      .select("organizationId, role")
      .eq("userId", userId)
      .order("organizationId")
      .limit(1)
      .maybeSingle();
    member = data as typeof member;
  }
  organizationId = member?.organizationId ?? null;

  if (!member || !organizationId) {
    return apiError("FORBIDDEN", "No organization found for this API key user.", 403);
  }

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("status")
    .eq("id", organizationId)
    .maybeSingle();
  const status = (org?.status as string | undefined) ?? (org ? "ACTIVE" : null);
  if (!status || status === "DELETED") {
    return apiError("FORBIDDEN", "This organization is no longer available.", 403);
  }

  const readOnly = member.role === "VIEWER" || status !== "ACTIVE";
  if (readOnly) {
    scopes = readOnlyScopes(scopes);
    const blocked = missingScope(scopes, requiredScope);
    if (blocked) {
      return apiError(
        "FORBIDDEN",
        status !== "ACTIVE"
          ? "This organization is paused. API changes are blocked until it is resumed."
          : `The API key owner's role (viewer) does not allow "${blocked}".`,
        403,
      );
    }
  }

  supabaseAdmin
    .from("api_keys")
    .update({ lastUsedAt: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then();

  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organizationId", organizationId);

  const allProjectIds = (projects ?? []).map((p) => p.id);
  const writeRequest =
    requiredScope !== null &&
    (typeof requiredScope === "string" ? [requiredScope] : requiredScope).some((s) => s === "*" || s.endsWith(":write"));
  const projectIds = await filterAccessibleProjectIds(
    supabaseAdmin,
    allProjectIds,
    userId,
    writeRequest ? { minRole: "MEMBER" } : {},
  );

  return {
    userId,
    organizationId,
    projectIds,
    apiKeyId: apiKey.id as string,
    environment: ((apiKey.environment as string) === "test" ? "test" : "live"),
    scopes,
    readOnly,
  };
}

export function isAuthError(
  result: ApiKeyAuth | Response,
): result is Response {
  return result instanceof Response;
}

/** Fire-and-forget API usage log (shown on Interview Form Integration → Connect). */
let usageDurationColumn = true;

export function logApiUsage(
  request: Request,
  status: number,
  auth?: Partial<ApiKeyAuth> | null,
  durationMs?: number,
) {
  try {
    const url = new URL(request.url);
    const row = {
      organizationId: auth?.organizationId ?? null,
      apiKeyId: auth?.apiKeyId ?? null,
      method: request.method,
      endpoint: url.pathname.slice(0, 300),
      status,
    };
    const withDuration =
      usageDurationColumn && typeof durationMs === "number"
        ? { ...row, durationMs: Math.round(durationMs) }
        : row;
    supabaseAdmin
      .from("api_usage_logs")
      .insert(withDuration)
      .then(({ error }) => {
        // Migration 29 adds durationMs; until then log without it.
        if (error && "durationMs" in withDuration) {
          usageDurationColumn = false;
          supabaseAdmin.from("api_usage_logs").insert(row).then();
        }
      });
  } catch {
    /* ignore */
  }
}

/** Run an authenticated v1 handler and log its usage. */
export async function withApiKey(
  request: Request,
  scope: ApiKeyScope | readonly ApiKeyScope[],
  handler: (auth: ApiKeyAuth) => Promise<Response>,
): Promise<Response> {
  const started = Date.now();
  const auth = await validateApiKey(request, scope);
  if (isAuthError(auth)) {
    logApiUsage(request, auth.status, null, Date.now() - started);
    return auth;
  }
  let res: Response;
  try {
    res = await handler(auth);
  } catch (err) {
    console.error("[api/v1] unhandled error", err);
    res = apiError("INTERNAL_ERROR", "Unexpected server error", 500);
  }
  logApiUsage(request, res.status, auth, Date.now() - started);
  return res;
}
