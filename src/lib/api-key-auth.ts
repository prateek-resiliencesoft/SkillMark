import { checkRateLimit } from "@/lib/api-rate-limit";
import { hashApiKey, keyHasScope, type ApiKeyScope } from "@/lib/api-keys";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { filterAccessibleProjectIds } from "@/server/trpc";

export interface ApiKeyAuth {
  userId: string;
  organizationId: string;
  projectIds: string[];
  apiKeyId?: string;
  environment?: "test" | "live";
  scopes?: string[];
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
  requiredScope?: ApiKeyScope,
): Promise<ApiKeyAuth | Response> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer dlv_")) {
    return apiError(
      "UNAUTHORIZED",
      "Missing or invalid API key. Use: Authorization: Bearer dlv_xxx",
      401,
    );
  }

  const key = auth.slice(7).trim();
  if (key.length > 200) {
    return apiError("UNAUTHORIZED", "Invalid or revoked API key.", 401);
  }
  const keyHash = hashApiKey(key);

  const { data: apiKey } = await supabaseAdmin
    .from("api_keys")
    .select("id, userId, isActive, expiresAt, environment, scopes, organizationId")
    .eq("keyHash", keyHash)
    .maybeSingle();

  if (!apiKey || !apiKey.isActive) {
    return apiError("UNAUTHORIZED", "Invalid or revoked API key.", 401);
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
    return apiError("UNAUTHORIZED", "API key has expired.", 401);
  }

  const rateLimited = checkRateLimit(`key:${apiKey.id}`);
  if (rateLimited) return rateLimited;

  if (requiredScope && !keyHasScope(apiKey.scopes as string[], requiredScope)) {
    return apiError("FORBIDDEN", `This API key lacks the "${requiredScope}" permission.`, 403);
  }

  supabaseAdmin
    .from("api_keys")
    .update({ lastUsedAt: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then();

  const userId: string = apiKey.userId;
  let organizationId: string | null = (apiKey.organizationId as string | null) ?? null;

  if (organizationId) {
    const { data: member } = await supabaseAdmin
      .from("organization_members")
      .select("workspaceId")
      .eq("userId", userId)
      .eq("workspaceId", organizationId)
      .maybeSingle();
    if (!member) organizationId = null;
  } else {
    const { data: membership } = await supabaseAdmin
      .from("organization_members")
      .select("workspaceId")
      .eq("userId", userId)
      .order("workspaceId")
      .limit(1)
      .maybeSingle();
    organizationId = (membership?.workspaceId as string | undefined) ?? null;
  }

  if (!organizationId) {
    return apiError("FORBIDDEN", "No organization found for this API key user.", 403);
  }

  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organizationId", organizationId);

  const allProjectIds = (projects ?? []).map((p) => p.id);
  const projectIds = await filterAccessibleProjectIds(
    supabaseAdmin,
    allProjectIds,
    userId,
  );

  return {
    userId,
    organizationId,
    projectIds,
    apiKeyId: apiKey.id as string,
    environment: ((apiKey.environment as string) === "test" ? "test" : "live"),
    scopes: (apiKey.scopes as string[]) ?? ["*"],
  };
}

export function isAuthError(
  result: ApiKeyAuth | Response,
): result is Response {
  return result instanceof Response;
}

/** Fire-and-forget API usage log (shown on Interview Form Integration → Connect). */
export function logApiUsage(
  request: Request,
  status: number,
  auth?: Partial<ApiKeyAuth> | null,
) {
  try {
    const url = new URL(request.url);
    supabaseAdmin
      .from("api_usage_logs")
      .insert({
        organizationId: auth?.organizationId ?? null,
        apiKeyId: auth?.apiKeyId ?? null,
        method: request.method,
        endpoint: url.pathname.slice(0, 300),
        status,
      })
      .then();
  } catch {
    /* ignore */
  }
}

/** Run an authenticated v1 handler and log its usage. */
export async function withApiKey(
  request: Request,
  scope: ApiKeyScope | undefined,
  handler: (auth: ApiKeyAuth) => Promise<Response>,
): Promise<Response> {
  const auth = await validateApiKey(request, scope);
  if (isAuthError(auth)) {
    logApiUsage(request, auth.status, null);
    return auth;
  }
  let res: Response;
  try {
    res = await handler(auth);
  } catch (err) {
    console.error("[api/v1] unhandled error", err);
    res = apiError("INTERNAL_ERROR", "Unexpected server error", 500);
  }
  logApiUsage(request, res.status, auth);
  return res;
}
