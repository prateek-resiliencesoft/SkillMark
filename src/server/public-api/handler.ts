/**
 * Runs one registry endpoint as a Next.js route handler: API key auth, scope
 * check, rate limit (in validateApiKey), zod validation, usage logging and
 * consistent JSON errors.
 */
import { apiError, withApiKey, type ApiKeyAuth } from "@/lib/api-key-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { z } from "zod";
import { endpointById, type EndpointDef, type EndpointId } from "./endpoints";
import * as service from "./service";
import { ApiProblem, type ApiCtx } from "./service";
import { publicOrigin } from "./origin";

type Input = { params?: Record<string, string>; query?: unknown; body?: unknown };

/** Map an endpoint to its service function. Shared with the MCP tools. */
export async function runEndpoint(e: EndpointDef, ctx: ApiCtx, input: Input): Promise<unknown> {
  const p = input.params as { id: string } | undefined;
  switch (e.id) {
    case "listSessions":
      return service.listSessions(ctx, input.query as never);
    case "getSession":
      return service.getSession(ctx, p!.id);
    case "getResult":
      return service.getResult(ctx, p!.id);
    case "getTranscript":
      return service.getTranscript(ctx, p!.id);
    case "listInterviews":
      return service.listInterviews(ctx, input.query as never);
    case "listCandidates":
      return service.listCandidates(ctx, input.query as never);
    case "createInvite":
      return service.createInvite(ctx, input.body as never);
  }
}

export function zodDetails(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[issue.path.join(".") || "(root)"] = issue.message;
  return out;
}

export function problemResponse(err: unknown): Response {
  if (err instanceof ApiProblem) return apiError(err.code, err.message, err.status, err.details ? { details: err.details } : undefined);
  console.error("[api/v1] unhandled error", err);
  return apiError("INTERNAL_ERROR", "Unexpected server error", 500);
}

export function ctxFor(auth: ApiKeyAuth, request: Request): ApiCtx {
  return {
    db: supabaseAdmin,
    auth: { organizationId: auth.organizationId, projectIds: auth.projectIds, scopes: auth.scopes, apiKeyId: auth.apiKeyId },
    origin: publicOrigin(request),
  };
}

/** Build a Next.js handler for one endpoint. */
export function routeHandler(id: EndpointId) {
  const e = endpointById(id);
  return async (request: Request, route?: { params?: Promise<Record<string, string>> | Record<string, string> }) =>
    withApiKey(request, e.scope, async (auth) => {
      const rawParams = (await route?.params) ?? {};
      const params = e.params ? e.params.safeParse(rawParams) : null;
      if (params && !params.success) return apiError("NOT_FOUND", "Not found", 404);

      let query: unknown;
      if (e.query) {
        const url = new URL(request.url);
        const parsed = e.query.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) return apiError("BAD_REQUEST", "Invalid query parameters", 400, { details: zodDetails(parsed.error) });
        query = parsed.data;
      }

      let body: unknown;
      if (e.body) {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return apiError("BAD_REQUEST", "Body must be JSON", 400);
        }
        const parsed = e.body.safeParse(raw);
        if (!parsed.success) return apiError("BAD_REQUEST", "Invalid request body", 400, { details: zodDetails(parsed.error) });
        body = parsed.data;
      }

      try {
        const out = await runEndpoint(e, ctxFor(auth, request), { params: params?.data as Record<string, string> | undefined, query, body });
        return Response.json(out, { status: e.successStatus, headers: { "Cache-Control": "no-store" } });
      } catch (err) {
        return problemResponse(err);
      }
    });
}
