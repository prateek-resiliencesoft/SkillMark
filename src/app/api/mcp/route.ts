import { isAuthError, logApiUsage, validateApiKey } from "@/lib/api-key-auth";
import { buildMcpServer } from "@/server/integrations/mcp-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
};

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/**
 * Accepts `Authorization: Bearer dlv_…`. As a fallback for clients that cannot
 * send headers (e.g. ChatGPT "No authentication" connectors) the key may be
 * passed as `?key=dlv_…` — this puts the secret in URLs/logs, so use a
 * dedicated, minimally-scoped key and rotate it if the URL leaks.
 */
function authRequest(req: Request): Request {
  if (req.headers.get("authorization")) return req;
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return req;
  const h = new Headers(req.headers);
  h.set("authorization", `Bearer ${key}`);
  return new Request(req.url, { method: req.method, headers: h, body: req.body, duplex: "half" } as RequestInit);
}

async function handle(req: Request): Promise<Response> {
  const authed = authRequest(req);
  const auth = await validateApiKey(authed);
  if (isAuthError(auth)) {
    const body = await auth.text();
    logApiUsage(req, auth.status, null);
    return withCors(new Response(body, {
      status: auth.status,
      headers: { "content-type": "application/json", ...(auth.status === 401 ? { "WWW-Authenticate": 'Bearer realm="skillmark-mcp", error="invalid_token"' } : {}) },
    }));
  }
  if (req.method === "GET" || req.method === "DELETE") {
    // Stateless server: no standalone SSE stream / sessions.
    return withCors(Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null }, { status: 405, headers: { Allow: "POST, OPTIONS" } }));
  }
  const server = buildMcpServer(auth, req);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(authed);
    return withCors(res);
  } finally {
    // stateless: close after the response body has been produced
    setTimeout(() => { transport.close().catch(() => {}); server.close().catch(() => {}); }, 30_000).unref?.();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
