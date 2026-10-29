/**
 * AES-256-GCM encryption for third-party API keys stored in Postgres.
 * Key is derived from AUTH_SECRET, so a DB dump alone doesn't leak them.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHash("sha256").update(`skillmark-integrations:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** "re_abc…xyz9" style hint so the UI can show a key is set without exposing it. */
export function maskSecret(stored: string | null | undefined): string | null {
  const plain = decryptSecret(stored);
  if (!plain) return null;
  return plain.length <= 8 ? "••••" : `${plain.slice(0, 4)}…${plain.slice(-4)}`;
}
