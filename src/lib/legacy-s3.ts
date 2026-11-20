/**
 * Read-only access to the old S3-compatible bucket (Backblaze B2 / R2 / S3).
 *
 * New media is written to the server disk (STORAGE_DIR). Interviews recorded
 * before that move live only in the bucket, so while S3_* (or B2_* / R2_*)
 * credentials are set, reads fall back to it: playback, report re-transcribe
 * and rebuilding a recording from its uploaded parts. Nothing here writes or
 * deletes in the bucket. Set STORAGE_LEGACY_S3=off to disable.
 *
 * Signed with AWS SigV4 using node:crypto only (no SDK). Secrets never leave
 * this module and are never logged.
 */
import { createHash, createHmac } from "node:crypto";

export type LegacyS3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const first = (...vals: (string | undefined)[]) => vals.map((v) => v?.trim()).find((v) => !!v) ?? "";

export function legacyS3Config(env: NodeJS.ProcessEnv = process.env): LegacyS3Config | null {
  if (/^(off|false|0|no)$/i.test(env.STORAGE_LEGACY_S3?.trim() ?? "")) return null;
  const accountId = first(env.R2_ACCOUNT_ID);
  const endpoint = first(
    env.S3_ENDPOINT,
    env.B2_ENDPOINT,
    env.R2_ENDPOINT,
    accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined,
  ).replace(/\/+$/, "");
  const cfg = {
    endpoint,
    bucket: first(env.S3_BUCKET, env.B2_BUCKET, env.R2_BUCKET),
    region: first(env.S3_REGION, env.B2_REGION) || "auto",
    accessKeyId: first(env.S3_ACCESS_KEY_ID, env.B2_KEY_ID, env.R2_ACCESS_KEY_ID),
    secretAccessKey: first(env.S3_SECRET_ACCESS_KEY, env.B2_APPLICATION_KEY, env.R2_SECRET_ACCESS_KEY),
  };
  return cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey ? cfg : null;
}

export function isLegacyS3Enabled(): boolean {
  return legacyS3Config() !== null;
}

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 expects (keeps unreserved chars only). */
export function awsEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Build a SigV4-signed request (path-style URL: endpoint/bucket/key). Pure apart from the clock. */
export function signS3Request(
  cfg: LegacyS3Config,
  method: "GET" | "HEAD",
  objKey: string | null,
  query: Record<string, string> = {},
  extraHeaders: Record<string, string> = {},
  now = new Date(),
): { url: string; headers: Record<string, string> } {
  const url = new URL(cfg.endpoint);
  const keyPath = objKey ? `/${objKey.replace(/^\/+/, "").split("/").map(awsEncode).join("/")}` : "";
  const basePath = url.pathname.replace(/\/+$/, "");
  const canonicalUri = `${basePath}/${awsEncode(cfg.bucket)}${keyPath}` || "/";
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${awsEncode(k)}=${awsEncode(query[k])}`)
    .join("&");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex("");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${String(headers[h]).trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, dateStamp), cfg.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host; // fetch sets it
  return { url: `${url.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`, headers };
}

export type LegacyS3Object = { key: string; size: number; lastModified?: string };

const xmlUnescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Parse a ListObjectsV2 response page. */
export function parseListObjectsV2(xml: string): { objects: LegacyS3Object[]; nextToken: string | null } {
  const objects: LegacyS3Object[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const body = m[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1];
    if (!key) continue;
    objects.push({
      key: xmlUnescape(key),
      size: Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? 0),
      lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(body)?.[1],
    });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { objects, nextToken: truncated && next ? xmlUnescape(next) : null };
}

/** Every object under a prefix in the legacy bucket ([] when not configured). */
export async function listLegacyS3Objects(prefix: string, maxItems = 10_000): Promise<LegacyS3Object[]> {
  const cfg = legacyS3Config();
  if (!cfg) return [];
  const out: LegacyS3Object[] = [];
  let token: string | null = null;
  do {
    const query: Record<string, string> = { "list-type": "2", prefix: prefix.replace(/^\/+/, ""), "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const req = signS3Request(cfg, "GET", null, query);
    const res = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Legacy bucket list failed (${res.status})`);
    const page = parseListObjectsV2(await res.text());
    out.push(...page.objects);
    token = page.nextToken;
  } while (token && out.length < maxItems);
  return out.slice(0, maxItems);
}

/** GET (optionally a byte range) from the legacy bucket. Returns null on 404 / not configured. */
export async function getLegacyS3Object(
  objKey: string,
  opts: { range?: string | null; method?: "GET" | "HEAD"; timeoutMs?: number } = {},
): Promise<Response | null> {
  const cfg = legacyS3Config();
  if (!cfg) return null;
  const req = signS3Request(cfg, opts.method ?? "GET", objKey, {}, opts.range ? { range: opts.range } : {});
  const res = await fetch(req.url, {
    method: opts.method ?? "GET",
    headers: req.headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  if (res.status === 404) return null;
  if (!res.ok && res.status !== 206 && res.status !== 416) {
    throw new Error(`Legacy bucket read failed for ${objKey.split("/").pop()} (${res.status})`);
  }
  return res;
}

/** Whole object as a Buffer, or null when it isn't in the bucket. */
export async function readLegacyS3Object(objKey: string): Promise<{ data: Buffer; contentType: string } | null> {
  const res = await getLegacyS3Object(objKey);
  if (!res) return null;
  return {
    data: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}
