import { createHash, randomBytes } from "crypto";

export type ApiKeyEnvironment = "test" | "live";
export const API_KEY_SCOPES = [
  "*",
  "interviews:read",
  "interviews:write",
  "forms:read",
  "applications:read",
  "applications:write",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** dlv_live_xxx / dlv_test_xxx. Only the hash is persisted. */
export function generateApiKey(environment: ApiKeyEnvironment) {
  const bytes = randomBytes(32);
  let secret = "";
  for (let i = 0; i < 32; i++) secret += ALPHABET[bytes[i] % ALPHABET.length];
  const key = `dlv_${environment}_${secret}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 16) };
}

export function keyHasScope(scopes: string[] | null | undefined, needed: ApiKeyScope): boolean {
  const s = scopes && scopes.length ? scopes : ["*"];
  if (s.includes("*")) return true;
  if (s.includes(needed)) return true;
  // write implies read for the same resource
  const [res, act] = needed.split(":");
  return act === "read" && s.includes(`${res}:write`);
}
