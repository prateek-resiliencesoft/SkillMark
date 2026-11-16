/**
 * Builds the OpenAPI 3.1 document: the results API is generated from the zod
 * schemas in ./endpoints.ts; older endpoints come from ./legacy-spec.ts.
 */
import { z } from "zod";
import { ENDPOINTS, type EndpointDef } from "./endpoints";
import { legacySpec } from "./legacy-spec";

type Json = Record<string, unknown>;

export function toSchema(schema: z.ZodType, io: "input" | "output" = "output"): Json {
  const out = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Json;
  delete out.$schema;
  return out;
}

function parameters(e: EndpointDef): Json[] {
  const list: Json[] = [];
  const add = (obj: z.ZodObject | undefined, where: "path" | "query") => {
    if (!obj) return;
    for (const [name, field] of Object.entries(obj.shape)) {
      const f = field as z.ZodType;
      const schema = toSchema(f, "input");
      const description = (schema.description as string | undefined) ?? f.description;
      delete schema.description;
      const example = e.paramExamples?.[name];
      list.push({
        name,
        in: where,
        ...(example !== undefined ? { example } : {}),
        required: where === "path" ? true : !f.isOptional(),
        ...(description ? { description } : {}),
        schema,
      });
    }
  };
  add(e.params, "path");
  add(e.query, "query");
  return list;
}

const errorRef = (name: string) => ({ $ref: `#/components/responses/${name}` });

export function operationFor(e: EndpointDef): Json {
  return {
    operationId: e.id,
    tags: [e.tag],
    summary: e.summary,
    description: `${e.description}\n\nRequires scope \`${e.scope}\`.`,
    "x-scope": e.scope,
    ...(e.mcpTool ? { "x-mcp-tool": e.mcpTool } : {}),
    parameters: parameters(e),
    ...(e.body
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: toSchema(e.body, "input"),
                ...(e.bodyExample !== undefined ? { example: e.bodyExample } : {}),
              },
            },
          },
        }
      : {}),
    responses: {
      [String(e.successStatus)]: {
        description: "Success",
        content: { "application/json": { schema: toSchema(e.response), example: e.example } },
      },
      "400": errorRef("BadRequest"),
      "401": errorRef("Unauthorized"),
      "403": errorRef("Forbidden"),
      ...(e.params ? { "404": errorRef("NotFound") } : {}),
      "429": errorRef("RateLimited"),
      "500": errorRef("InternalError"),
    },
  };
}

export const RESULTS_API_TAGS = [
  { name: "Sessions", description: "Candidate interview sessions." },
  { name: "Results", description: "Scores, summary and recommendation of a session." },
  { name: "Transcripts", description: "The conversation of a session." },
  { name: "Interviews", description: "Interview templates and publishing." },
  { name: "Candidates", description: "Invited candidates and invite links." },
  { name: "Invites", description: "Invite a candidate to an interview." },
];

export function buildOpenApiSpec(origin?: string): Json {
  const legacy = JSON.parse(JSON.stringify(legacySpec)) as Json & {
    paths: Record<string, Json>;
    tags: { name: string; description: string }[];
    components: Json & { responses?: Json; securitySchemes?: Json };
    info: Json;
  };

  const paths: Record<string, Json> = { ...legacy.paths };
  for (const e of ENDPOINTS) {
    paths[e.path] = { ...(paths[e.path] ?? {}), [e.method.toLowerCase()]: operationFor(e) };
  }

  const tags = [
    ...RESULTS_API_TAGS.map((t) => legacy.tags.find((l) => l.name === t.name) ?? t),
    ...legacy.tags.filter((t) => !RESULTS_API_TAGS.some((r) => r.name === t.name)),
  ].filter((t, i, arr) => arr.findIndex((x) => x.name === t.name) === i);

  const errorResponse = (description: string, code: string, message: string, details?: unknown) => ({
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
        example: { error: { code, message, ...(details ? { details } : {}) } },
      },
    },
  });

  return {
    ...legacy,
    info: {
      ...legacy.info,
      title: "ResilienceSoft Interview API",
      description: `Read interview sessions, results and transcripts, and invite candidates, from your own website or backend.

**Authentication:** create a key under **API** in the dashboard and send it as \`Authorization: Bearer rsi_live_…\`. Keys belong to one organization and only see its data. Call the API from your server, never from browser code.

**Errors** always look like \`{ "error": { "code": "NOT_FOUND", "message": "…" } }\`.

**Limits:** 60 requests per minute per key (HTTP 429 with \`Retry-After\` when exceeded).

**Pagination:** list endpoints return \`next_cursor\`; pass it back as \`cursor\` until it is null.`,
    },
    servers: [{ url: origin ? `${origin}/api/v1` : "/api/v1", description: "This deployment" }],
    tags,
    paths,
    components: {
      ...legacy.components,
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key",
          description: "Send `Authorization: Bearer rsi_live_…`. Older `dlv_` keys still work.",
        },
      },
      responses: {
        ...(legacy.components.responses ?? {}),
        BadRequest: errorResponse("The request is not valid. `error.details` lists the fields.", "BAD_REQUEST", "Invalid query parameters", {
          limit: "Too big: expected number to be <=100",
        }),
        Unauthorized: errorResponse("Missing, wrong, expired or revoked API key.", "UNAUTHORIZED", "Invalid or revoked API key."),
        Forbidden: errorResponse("The key does not have the needed scope.", "FORBIDDEN", 'This API key lacks the "results:read" permission.'),
        NotFound: errorResponse("Not found in this key's organization.", "NOT_FOUND", "Session not found"),
        RateLimited: errorResponse("Too many requests. Wait for `Retry-After` seconds.", "RATE_LIMITED", "Too many requests. Retry after 42s."),
        InternalError: errorResponse("Unexpected server error.", "INTERNAL_ERROR", "Unexpected server error"),
      },
    },
  };
}
