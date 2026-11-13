import { checkRateLimit } from "@/lib/api-rate-limit";
import { isPreflightEventStatus, isPreflightEventType } from "@/lib/preflight";
import { authorizePreflightSource, recordPreflightEvent } from "@/lib/preflight-server";
import { clientIp } from "@/server/integrations/applications";
import { NextResponse } from "next/server";

/**
 * Public, token/session-authorized event log for the candidate onboarding
 * flow. Recruiter views these in the candidate drawer. Rate-limited and
 * deduped; never stores photos or media.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : undefined;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
    const limited = checkRateLimit(
      `session:preflight:${token || sessionId || clientIp(req)}`,
      40,
    );
    if (limited) return limited;

    const type = typeof body?.type === "string" ? body.type : "";
    const status = typeof body?.status === "string" ? body.status : "";
    if (!isPreflightEventType(type) || !isPreflightEventStatus(status)) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    const auth = await authorizePreflightSource({ token, sessionId });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const detail =
      body?.detail && typeof body.detail === "object" && !Array.isArray(body.detail)
        ? sanitizeDetail(body.detail as Record<string, unknown>)
        : null;
    const device =
      body?.device && typeof body.device === "object" && !Array.isArray(body.device)
        ? sanitizeDevice(body.device as Record<string, unknown>)
        : null;

    const result = await recordPreflightEvent({
      candidateId: auth.candidateId,
      sessionId: auth.sessionId,
      inviteToken: auth.inviteToken,
      type,
      status,
      detail,
      device,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, deduped: result.deduped });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function sanitizeDetail(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 16)) {
    if (key.length > 40) continue;
    if (typeof value === "string") out[key] = value.slice(0, 300);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (value == null) out[key] = null;
  }
  // Never persist captured images if a client sends them by mistake.
  delete out.photo;
  delete out.image;
  delete out.dataUrl;
  delete out.thumbnail;
  return out;
}

function sanitizeDevice(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof input.userAgent === "string") out.userAgent = input.userAgent.slice(0, 400);
  if (typeof input.language === "string") out.language = input.language.slice(0, 40);
  if (typeof input.platform === "string") out.platform = input.platform.slice(0, 80);
  if (typeof input.vendor === "string") out.vendor = input.vendor.slice(0, 80);
  if (typeof input.timezone === "string") out.timezone = input.timezone.slice(0, 80);
  const screen = input.screen as { width?: unknown; height?: unknown } | undefined;
  if (screen && typeof screen === "object") {
    const width = Number(screen.width);
    const height = Number(screen.height);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      out.screen = { width: Math.round(width), height: Math.round(height) };
    }
  }
  return out;
}
