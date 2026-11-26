import "server-only";
import { AccessToken, DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import { createLogger } from "@/lib/logger";
import { admittedCandidatePermission, roomGrant, type RoomGrantKind } from "@/lib/round-two/grants";

export type { RoomGrantKind };

const log = createLogger("livekit");

export interface LiveKitConfig {
  /** Browser-facing ws(s) URL. */
  publicUrl: string;
  /** Server-to-server http(s) URL for the RoomService API. */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

export function liveKitConfig(): LiveKitConfig | null {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const publicUrl = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !publicUrl) return null;
  const apiUrl = (process.env.LIVEKIT_API_URL || publicUrl).replace(/^ws(s?):\/\//, "http$1://");
  return { publicUrl, apiUrl, apiKey, apiSecret };
}

export function requireLiveKit(): LiveKitConfig {
  const cfg = liveKitConfig();
  if (!cfg) throw new Error("Live video is not configured (set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).");
  return cfg;
}

export async function mintRoomToken(opts: {
  room: string;
  identity: string;
  name: string;
  kind: RoomGrantKind;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<string> {
  const cfg = requireLiveKit();
  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    metadata: JSON.stringify({ kind: opts.kind, ...(opts.metadata ?? {}) }),
    ttl: opts.ttlSeconds ?? 60 * 60 * 6,
  });
  at.addGrant(roomGrant(opts.kind, opts.room));
  return at.toJwt();
}

function roomService(): RoomServiceClient {
  const cfg = requireLiveKit();
  return new RoomServiceClient(cfg.apiUrl, cfg.apiKey, cfg.apiSecret);
}

export async function ensureRoom(room: string, maxParticipants = 12): Promise<void> {
  try {
    await roomService().createRoom({ name: room, emptyTimeout: 10 * 60, departureTimeout: 120, maxParticipants });
  } catch (err) {
    log.warn("createRoom failed", room, err instanceof Error ? err.message : err);
  }
}

/** Promote a lobby participant to full publish/subscribe. */
export async function admitParticipant(room: string, identity: string): Promise<void> {
  await roomService().updateParticipant(room, identity, { permission: admittedCandidatePermission() });
}

export async function removeParticipant(room: string, identity: string): Promise<void> {
  try {
    await roomService().removeParticipant(room, identity);
  } catch (err) {
    log.warn("removeParticipant failed", room, identity, err instanceof Error ? err.message : err);
  }
}

export async function closeRoom(room: string): Promise<void> {
  try {
    await roomService().deleteRoom(room);
  } catch (err) {
    log.warn("deleteRoom failed", room, err instanceof Error ? err.message : err);
  }
}

export async function listRoomIdentities(room: string): Promise<string[]> {
  try {
    const ps = await roomService().listParticipants(room);
    return ps.map((p) => p.identity);
  } catch {
    return [];
  }
}

/** Reliable data packet to specific identities only (never broadcast). */
export async function sendToIdentities(
  room: string,
  identities: string[],
  topic: string,
  payload: unknown,
): Promise<void> {
  if (identities.length === 0) return;
  try {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    await roomService().sendData(room, data, DataPacket_Kind.RELIABLE, { destinationIdentities: identities, topic });
  } catch (err) {
    log.warn("sendData failed", room, topic, err instanceof Error ? err.message : err);
  }
}
