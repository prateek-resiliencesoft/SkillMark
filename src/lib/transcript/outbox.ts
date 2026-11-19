/**
 * Client transcript outbox helpers (pure, unit-tested).
 *
 * Every transcript line gets a stable id when it is spoken. The server inserts
 * with "ignore duplicates" on that id, so the same line can be sent again
 * (retry, tab-close beacon, visibility change) without being stored twice.
 */

export type OutboxMessage = { id: string; seq: number };

/** UUID v4 for a transcript line (messages.id is a uuid primary key). */
export function newMessageId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Lines still waiting for a server ack plus new ones, once each, in spoken order. */
export function unsentMessages<T extends OutboxMessage>(inFlight: Iterable<T>, pending: T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of inFlight) byId.set(m.id, m);
  for (const m of pending) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
}

/**
 * Split messages into JSON bodies that each fit a beacon (browsers cap a
 * sendBeacon / keepalive body at ~64 KB). Only the last body carries
 * `complete`, so the session is marked complete after every line is in.
 */
export function beaconBodies(
  sessionId: string,
  messages: readonly OutboxMessage[],
  complete: boolean,
  maxBytes = 48_000,
  /** "quit" when the candidate ended the interview on purpose. */
  reason?: string,
): string[] {
  const size = (s: string) => new TextEncoder().encode(s).length;
  const bodies: string[] = [];
  let batch: OutboxMessage[] = [];
  const body = (msgs: OutboxMessage[], last: boolean) => JSON.stringify({ sessionId, messages: msgs, ...(last && complete ? { complete: true, ...(reason ? { reason } : {}) } : {}) });
  for (const m of messages) {
    const next = [...batch, m];
    if (batch.length && size(body(next, true)) > maxBytes) {
      bodies.push(body(batch, false));
      batch = [m];
    } else batch = next;
  }
  if (batch.length || complete) bodies.push(body(batch, true));
  return bodies;
}
