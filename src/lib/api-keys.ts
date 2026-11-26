import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { ApiKeyEnvironment } from "@/lib/api-scopes";

export * from "@/lib/api-scopes";

/** New keys: rsi_live_… / rsi_test_…. Older keys (dlv_…) keep working. */
export const API_KEY_PREFIX = "rsi";
const ACCEPTED_PREFIXES = ["rsi_", "dlv_"];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Constant-time compare of a presented key against a stored hash. */
export function verifyApiKey(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** rsi_live_xxx / rsi_test_xxx. Only the hash is persisted. */
export function generateApiKey(environment: ApiKeyEnvironment) {
  const bytes = randomBytes(32);
  let secret = "";
  for (let i = 0; i < 32; i++) secret += ALPHABET[bytes[i] % ALPHABET.length];
  const key = `${API_KEY_PREFIX}_${environment}_${secret}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 16) };
}

export function looksLikeApiKey(value: string | null | undefined): boolean {
  if (!value) return false;
  return ACCEPTED_PREFIXES.some((p) => value.startsWith(p)) && value.length <= 200;
}

/** Extract the key from `Authorization: Bearer <key>`; null if absent/malformed. */
export function parseBearerKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return null;
  return looksLikeApiKey(m[1]) ? m[1] : null;
}

/** True when the Authorization header carries an API key (not a session JWT). */
export function isApiKeyAuthHeader(header: string | null | undefined): boolean {
  return !!header && /^Bearer\s+(rsi_|dlv_)/i.test(header);
}
