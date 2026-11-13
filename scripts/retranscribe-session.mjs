#!/usr/bin/env node
/**
 * Rebuild one session's candidate transcript from its recording and
 * regenerate the report, via the running app (POST /api/session/retranscribe).
 *
 * Run inside the app container (it already has CRON_SECRET / AUTH_SECRET):
 *   docker exec -i skillmark-app-1 node --input-type=module - <sessionId> < scripts/retranscribe-session.mjs
 * or with a checkout + env:
 *   node scripts/retranscribe-session.mjs <sessionId>
 *
 * Optional: APP_URL (default http://127.0.0.1:$PORT, PORT default 3000).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionId = process.argv.slice(1).find((a) => UUID_RE.test(a)) || process.env.SESSION_ID;
if (!sessionId || !UUID_RE.test(sessionId)) {
  console.error("Usage: retranscribe-session.mjs <sessionId>");
  process.exit(2);
}
const secret = process.env.CRON_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
if (!secret) {
  console.error("CRON_SECRET or AUTH_SECRET must be set (run this inside the app container).");
  process.exit(2);
}
const base = (process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, "");

console.log(`Re-transcribing ${sessionId} via ${base} … (can take a few minutes)`);
const started = Date.now();
try {
  const res = await fetch(`${base}/api/session/retranscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-retranscribe-secret": secret },
    body: JSON.stringify({ sessionId }),
    signal: AbortSignal.timeout(330_000),
  });
  const body = await res.json().catch(() => ({}));
  const secs = Math.round((Date.now() - started) / 1000);
  if (!res.ok) {
    console.error(`Failed (${res.status}) after ${secs}s: ${body.error || "unknown error"}`);
    process.exit(1);
  }
  console.log(`Done in ${secs}s`);
  console.log(`  candidate lines : ${body.candidateLines} (${body.candidateWords} words)`);
  console.log(`  replaced lines  : ${body.replacedLines}${body.backupPath ? ` (backup: ${body.backupPath})` : ""}`);
  console.log(`  model           : ${body.model}`);
  console.log(`  report          : ${body.summary}`);
} catch (err) {
  console.error(`Request failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
