import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Bearer ROUND2_AGENT_SECRET (constant-time compare). Fails closed when unset. */
export function isAgentRequest(req: Request): boolean {
  const secret = process.env.ROUND2_AGENT_SECRET;
  if (!secret || secret.length < 16) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const a = Buffer.from(auth.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
