import { lookup } from "node:dns/promises";
import http, { type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export class ResponseTooLargeError extends Error {
  constructor(message = "Response body exceeds the allowed size") {
    super(message);
    this.name = "ResponseTooLargeError";
  }
}

function v4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

const BLOCKED_V4: Array<[number, number]> = [
  [v4(0, 0, 0, 0), 8], // "this" network / unspecified
  [v4(10, 0, 0, 0), 8],
  [v4(100, 64, 0, 0), 10], // CGNAT
  [v4(127, 0, 0, 0), 8],
  [v4(169, 254, 0, 0), 16], // link-local / cloud metadata
  [v4(172, 16, 0, 0), 12],
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 88, 99, 0), 24], // 6to4 relay anycast
  [v4(192, 168, 0, 0), 16],
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved + broadcast
];

function isBlockedV4(n: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === base;
  });
}

function parseV4(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  const [a, b, c, d] = ip.split(".").map(Number);
  return v4(a, b, c, d);
}

/** Parses an IPv6 literal into eight 16-bit groups; null when not valid IPv6. */
function parseV6(ip: string): number[] | null {
  const addr = ip.split("%")[0];
  if (isIP(addr) !== 6) return null;
  let text = addr.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const n = parseV4(tail);
    if (n === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.split("::") as [string, string | undefined];
  const toGroups = (s: string) => (s ? s.split(":").map((g) => parseInt(g, 16)) : []);
  const h = toGroups(head);
  if (rest === undefined) return h.length === 8 ? h : null;
  const t = toGroups(rest);
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  return [...h, ...new Array<number>(fill).fill(0), ...t];
}

function embeddedV4(hi: number, lo: number): number {
  return ((hi << 16) >>> 0) + lo;
}

/**
 * True when the address must not be contacted from the server (loopback, private, link-local,
 * CGNAT, multicast, documentation, reserved, and IPv6 forms that embed or tunnel to such IPv4).
 * Unparseable input is treated as restricted.
 */
export function isPrivateIp(ip: string): boolean {
  const raw = ip.trim().replace(/^\[|\]$/g, "");
  const n4 = parseV4(raw);
  if (n4 !== null) return isBlockedV4(n4);

  const g = parseV6(raw);
  if (!g) return true;

  // IPv4-mapped ::ffff:0:0/96 (WHATWG canonicalizes ::ffff:127.0.0.1 to ::ffff:7f00:1)
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isBlockedV4(embeddedV4(g[6], g[7]));
  }
  // NAT64 well-known prefix 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isBlockedV4(embeddedV4(g[6], g[7]));
  }
  // 6to4 2002::/16 tunnels to the embedded IPv4
  if (g[0] === 0x2002) return isBlockedV4(embeddedV4(g[1], g[2]));
  // Only global unicast 2000::/3 is reachable; this rejects ::, ::1, IPv4-compatible ::/96,
  // 64:ff9b:1::/48, 100::/64, fc00::/7, fe80::/10, fec0::/10 and ff00::/8.
  if ((g[0] & 0xe000) !== 0x2000) return true;
  // 2001::/23 IETF special-purpose (Teredo 2001::/32, benchmarking, ORCHID)
  if (g[0] === 0x2001 && g[1] < 0x0200) return true;
  // Documentation 2001:db8::/32 and 3fff::/20
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  if (g[0] === 0x3fff && g[1] < 0x1000) return true;
  return false;
}

export type SafeUrlOptions = {
  /** Permit plain http:// (default: https only). */
  allowHttp?: boolean;
};

type ResolvedTarget = { url: URL; addresses: Array<{ address: string; family: number }> };

type HostResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const dnsResolver: HostResolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true }).catch(() => []);

async function resolveSafeTarget(
  targetUrl: string | URL,
  options: SafeUrlOptions,
  resolveHost: HostResolver,
  isRestricted: (ip: string) => boolean,
): Promise<ResolvedTarget> {
  let parsed: URL;
  try {
    parsed = new URL(String(targetUrl));
  } catch {
    throw new UnsafeUrlError("Invalid URL format");
  }

  const httpAllowed = options.allowHttp && parsed.protocol === "http:";
  if (parsed.protocol !== "https:" && !httpAllowed) {
    throw new UnsafeUrlError("URL must use https scheme");
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError("URL must not contain credentials");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new UnsafeUrlError("Could not resolve host");
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await resolveHost(hostname);

  if (!addresses.length) {
    throw new UnsafeUrlError("Could not resolve host");
  }

  if (addresses.some((addr) => isRestricted(addr.address))) {
    throw new UnsafeUrlError("Host resolves to a restricted/private network address");
  }

  return { url: parsed, addresses };
}

/**
 * Validates that a URL is a secure, public HTTPS URL and does not resolve to loopback/private IPs (SSRF protection).
 * Validation alone does not stop DNS rebinding — use safeFetch to actually contact the host.
 */
export async function assertSafeRemoteUrl(
  targetUrl: string | URL,
  options: SafeUrlOptions = {},
): Promise<URL> {
  return (await resolveSafeTarget(targetUrl, options, dnsResolver, isPrivateIp)).url;
}

export type SafeFetchInit = RequestInit & {
  /** Maximum response body bytes (default 10 MiB). */
  maxBytes?: number;
  /** Deadline for the whole exchange including body (default 15s). */
  timeoutMs?: number;
  /** Maximum redirects followed, each revalidated (default 3). */
  maxRedirects?: number;
} & SafeUrlOptions;

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

function pinnedLookup(addresses: ResolvedTarget["addresses"]): LookupFunction {
  return ((_hostname: string, opts: { all?: boolean } | number | undefined, cb: (...args: unknown[]) => void) => {
    const callback = typeof opts === "function" ? (opts as typeof cb) : cb;
    const all = typeof opts === "object" && opts?.all;
    if (all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }) as unknown as LookupFunction;
}

function requestOnce(
  target: ResolvedTarget,
  method: string,
  headers: OutgoingHttpHeaders,
  body: Buffer | undefined,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const { url } = target;
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        signal,
        agent: false,
        lookup: pinnedLookup(target.addresses),
      },
      resolve,
    );
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

function toResponse(res: IncomingMessage, url: URL, method: string, maxBytes: number, onSettled: () => void): Response {
  const headers = new Headers();
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    try {
      headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
    } catch {
      // skip header values the Fetch API rejects
    }
  }
  const status = res.statusCode && res.statusCode >= 200 && res.statusCode <= 599 ? res.statusCode : 502;

  let body: ReadableStream<Uint8Array> | null = null;
  if (NULL_BODY_STATUSES.has(status) || method === "HEAD") {
    res.resume();
    res.once("close", onSettled);
  } else {
    let total = 0;
    body = (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>).pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > maxBytes) throw new ResponseTooLargeError();
          controller.enqueue(chunk);
        },
      }),
    );
    res.once("close", onSettled);
  }

  const response = new Response(body, { status, statusText: res.statusMessage, headers });
  Object.defineProperty(response, "url", { value: url.href });
  return response;
}

/** Factory exposed for tests; production code should use `safeFetch`. */
export function createSafeFetch(
  resolveHost: HostResolver = dnsResolver,
  isRestricted: (ip: string) => boolean = isPrivateIp,
) {
  return async function safeFetchImpl(input: string | URL, init: SafeFetchInit = {}): Promise<Response> {
    const {
      maxBytes = DEFAULT_MAX_BYTES,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxRedirects = DEFAULT_MAX_REDIRECTS,
      allowHttp,
      redirect = "follow",
      signal: callerSignal,
      ...rest
    } = init;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) onCallerAbort();
      else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
    const settle = () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };

    try {
      let method = (rest.method || "GET").toUpperCase();
      let headers = new Headers(rest.headers);
      let body: Buffer | undefined;
      if (rest.body != null) {
        const serialized = new Request("http://placeholder.invalid/", {
          method,
          headers,
          body: rest.body,
          duplex: "half",
        } as RequestInit);
        body = Buffer.from(await serialized.arrayBuffer());
        headers = serialized.headers;
      }

      let current = String(input);
      for (let hop = 0; ; hop++) {
        const target = await resolveSafeTarget(current, { allowHttp }, resolveHost, isRestricted);
        const outgoing: OutgoingHttpHeaders = {};
        headers.forEach((value, key) => {
          if (key !== "host" && key !== "content-length" && key !== "connection") outgoing[key] = value;
        });
        if (!outgoing["accept-encoding"]) outgoing["accept-encoding"] = "identity";
        if (body) outgoing["content-length"] = String(body.length);

        const res = await requestOnce(target, method, outgoing, body, controller.signal);
        const status = res.statusCode ?? 0;
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location && redirect !== "manual") {
          res.resume();
          if (redirect === "error") throw new UnsafeUrlError("Redirects are not allowed");
          if (hop >= maxRedirects) throw new UnsafeUrlError("Too many redirects");
          const next = new URL(location, target.url);
          if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
            if (method !== "HEAD") method = "GET";
            body = undefined;
            headers.delete("content-type");
          }
          if (next.origin !== target.url.origin) {
            for (const h of CREDENTIAL_HEADERS) headers.delete(h);
          }
          current = next.href;
          continue;
        }

        const declared = Number(res.headers["content-length"] || "0");
        if (declared > maxBytes) {
          res.destroy();
          throw new ResponseTooLargeError();
        }
        controller.signal.addEventListener("abort", () => res.destroy(new Error("Request aborted")), { once: true });
        return toResponse(res, target.url, method, maxBytes, settle);
      }
    } catch (err) {
      settle();
      throw err;
    }
  };
}

/**
 * fetch() for user-influenced URLs: validates scheme and every resolved address, pins the connection
 * to the validated IP (no DNS rebinding), revalidates each redirect hop, never auto-decompresses,
 * and caps the response body size and total duration.
 */
export const safeFetch = createSafeFetch();
