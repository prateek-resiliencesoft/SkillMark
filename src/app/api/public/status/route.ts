import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import { getPublicUptimeStatus } from "@/lib/uptime/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Public app status for the marketing site (excludes /admin monitors). */
export async function GET(request: Request) {
  const limited = checkRateLimit(`pubstatus:${clientIp(request)}`);
  if (limited) {
    for (const [k, v] of Object.entries(CORS)) limited.headers.set(k, v);
    return limited;
  }

  const status = await getPublicUptimeStatus();
  return Response.json(
    {
      data: {
        overall: status.overall,
        checkedAt: status.checkedAt,
        configured: status.configured,
        monitors: status.monitors.map((m) => ({
          id: m.id,
          name: m.name,
          status: m.status,
          statusLabel: m.statusLabel,
          uptimeRatio: m.uptimeRatio,
          averageResponseMs: m.averageResponseMs,
          responseTimes: m.responseTimes,
        })),
        ...(status.error ? { error: status.error } : {}),
      },
    },
    { status: 200, headers: CORS },
  );
}
