/**
 * Trusted client IP for rate limiting and audit.
 *
 * CF-Connecting-IP is only honored when the deployment sits behind Cloudflare
 * (TRUST_CF_CONNECTING_IP=1); otherwise any client could set it to rotate
 * rate-limit buckets. X-Real-IP is set by Caddy from the TCP peer; the first
 * X-Forwarded-For entry is the fallback for other proxies.
 */
export function clientIp(req: Request | { headers: Headers }): string {
  const h = req.headers;
  if (process.env.TRUST_CF_CONNECTING_IP === "1") {
    const cf = h.get("cf-connecting-ip")?.trim();
    if (cf) return cf;
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first;
  return "unknown";
}
