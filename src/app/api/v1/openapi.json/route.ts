/**
 * OpenAPI 3.1 document for the Developer API (`/api/v1`).
 * Served at GET /api/v1/openapi.json. Built from the zod schemas in
 * src/server/public-api so it always matches the handlers.
 */
import { buildOpenApiSpec } from "@/server/public-api/openapi";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(buildOpenApiSpec(new URL(request.url).origin), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
