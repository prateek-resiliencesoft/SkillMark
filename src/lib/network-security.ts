import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return (
      l === "::1" ||
      l.startsWith("fc") ||
      l.startsWith("fd") ||
      l.startsWith("fe80") ||
      l === "::" ||
      l.startsWith("::ffff:127.") ||
      l.startsWith("::ffff:10.") ||
      l.startsWith("::ffff:192.168.")
    );
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/**
 * Validates that a URL is a secure, public HTTPS URL and does not resolve to loopback/private IPs (SSRF protection).
 */
export async function assertSafeRemoteUrl(targetUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("URL must use https scheme");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true }).catch(() => []);

  if (!addresses.length) {
    throw new Error("Could not resolve host");
  }

  if (addresses.some((addr) => isPrivateIp(addr.address))) {
    throw new Error("Host resolves to a restricted/private network address");
  }

  return parsed;
}
