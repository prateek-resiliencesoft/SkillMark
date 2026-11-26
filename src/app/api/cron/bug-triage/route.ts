import { runBugTriageWorker } from "@/lib/bug-triage/worker";
import { createLogger } from "@/lib/logger";

const log = createLogger("cron/bug-triage");

/**
 * Process pending triage_events: AI cluster → buckets → maybe GitHub issue.
 * Auth: Authorization: Bearer $CRON_SECRET
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
    const result = await runBugTriageWorker();
    log.info("bug triage done", result);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    log.error("bug triage failed", err);
    return Response.json({ error: "Bug triage failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
