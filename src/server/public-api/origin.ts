/**
 * Public origin of this deployment as the caller sees it. Behind Caddy/Docker,
 * `request.url` is the container address (e.g. https://0.0.0.0:3000), so use
 * the forwarded / Host header first, then NEXT_PUBLIC_APP_URL.
 */
export function publicOrigin(request: Request): string {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim();
  if (host && !/^(0\.0\.0\.0|\[::\])(:|$)/.test(host)) {
    const fwd = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
    return `${fwd || (local ? "http" : "https")}://${host}`;
  }
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (env) return env;
  return new URL(request.url).origin;
}
