import { purgeExpiredSetAsideMedia } from "@/lib/media-review";
import { createLogger } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase/admin";

const log = createLogger("cron/purge-media");

/**
 * Clear object storage for set-aside sessions past mediaExpiresAt (15 days).
 * DB scores / messages / profile stay. Auth: Authorization: Bearer $CRON_SECRET
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await purgeExpiredSetAsideMedia(supabaseAdmin);
    log.info("purge done", result);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    log.error("purge failed", err);
    return Response.json({ error: "Purge failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
