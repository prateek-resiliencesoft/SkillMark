/**
 * UptimeRobot monitors for public status + super-admin /admin/status.
 *
 * Env:
 *   UPTIMEROBOT_API_KEY   Main API key (write needed to create monitors)
 */

import {
  isMonitorPublic,
  loadUptimeVisibility,
  type UptimeVisibility,
} from "@/lib/uptime/visibility";

export type UptimeStatusCode = 0 | 1 | 2 | 8 | 9;

export type MonitorAudience = "public" | "admin";

export type UptimeResponsePoint = {
  /** Unix seconds */
  at: number;
  /** Response time in ms */
  ms: number;
};

export type UptimeMonitor = {
  id: number;
  name: string;
  url: string;
  status: UptimeStatusCode;
  statusLabel: string;
  /** 0–100 when available */
  uptimeRatio: number | null;
  /** Average response time (ms) when available */
  averageResponseMs: number | null;
  /** Recent response samples (oldest → newest) for BarSparkline */
  responseTimes: UptimeResponsePoint[];
  intervalSeconds: number;
  /** Heuristic from URL/name (/admin → admin) */
  audience: MonitorAudience;
  /** Effective public surface (landing + user /status) */
  isPublic: boolean;
};

export type UptimeStatusResult = {
  configured: boolean;
  overall: "operational" | "degraded" | "down" | "unknown";
  checkedAt: string;
  monitors: UptimeMonitor[];
  error?: string;
};

/** UptimeRobot monitor.status */
const STATUS_LABEL: Record<number, string> = {
  0: "Paused",
  1: "Not checked yet",
  2: "Up",
  8: "Seems down",
  9: "Down",
};

const RESPONSE_TIMES_LIMIT = 24;

function cfg() {
  const apiKey = (process.env.UPTIMEROBOT_API_KEY || "").trim();
  return { apiKey, ok: !!apiKey };
}

/** Heuristic: admin panel probe — default hidden from public until allowlist says otherwise. */
export function isAdminMonitor(name: string, url: string): boolean {
  const hay = `${name} ${url}`.toLowerCase();
  return hay.includes("/admin");
}

function mapStatus(code: number): UptimeStatusCode {
  if (code === 0 || code === 1 || code === 2 || code === 8 || code === 9) {
    return code;
  }
  return 1;
}

function overallFrom(monitors: UptimeMonitor[]): UptimeStatusResult["overall"] {
  const active = monitors.filter((m) => m.status !== 0);
  if (active.length === 0) return "unknown";
  if (active.some((m) => m.status === 9)) return "down";
  if (active.some((m) => m.status === 8 || m.status === 1)) return "degraded";
  if (active.every((m) => m.status === 2)) return "operational";
  return "degraded";
}

type RawMonitor = {
  id: number;
  friendly_name: string;
  url: string;
  status: number;
  interval: number;
  custom_uptime_ratio?: string;
  average_response_time?: number | string;
  response_times?: { datetime: number; value: number }[];
};

let cache: { at: number; result: UptimeStatusResult; visKey: string } | null =
  null;
const CACHE_MS = 45_000;

function visCacheKey(vis: UptimeVisibility) {
  return `${vis.seeded}:${vis.publicIds.slice().sort((a, b) => a - b).join(",")}`;
}

export function invalidateUptimeCache() {
  cache = null;
}

function mapMonitors(
  raw: RawMonitor[],
  vis: UptimeVisibility,
): UptimeMonitor[] {
  return raw.map((m) => {
    const status = mapStatus(m.status);
    const ratioRaw = m.custom_uptime_ratio?.split("-")[0]?.trim();
    const ratio = ratioRaw ? Number.parseFloat(ratioRaw) : NaN;
    const avgRaw =
      typeof m.average_response_time === "string"
        ? Number.parseFloat(m.average_response_time)
        : m.average_response_time;
    const responseTimes = [...(m.response_times ?? [])]
      .reverse()
      .map((p) => ({ at: p.datetime, ms: p.value }));
    const audience: MonitorAudience = isAdminMonitor(
      m.friendly_name,
      m.url,
    )
      ? "admin"
      : "public";

    return {
      id: m.id,
      name: m.friendly_name,
      url: m.url,
      status,
      statusLabel: STATUS_LABEL[status] ?? "Unknown",
      uptimeRatio: Number.isFinite(ratio) ? ratio : null,
      averageResponseMs:
        avgRaw != null && Number.isFinite(avgRaw) ? avgRaw : null,
      responseTimes,
      intervalSeconds: m.interval,
      audience,
      isPublic: isMonitorPublic(m.id, audience === "public", vis),
    };
  });
}

async function fetchAllMonitors(): Promise<UptimeStatusResult> {
  const { apiKey, ok } = cfg();
  const checkedAt = new Date().toISOString();
  const vis = await loadUptimeVisibility();
  const vKey = visCacheKey(vis);

  if (!ok) {
    return {
      configured: false,
      overall: "unknown",
      checkedAt,
      monitors: [],
      error: "UPTIMEROBOT_API_KEY is not set",
    };
  }

  if (cache && Date.now() - cache.at < CACHE_MS && cache.visKey === vKey) {
    return {
      ...cache.result,
      checkedAt,
      monitors: cache.result.monitors.map((m) => ({
        ...m,
        isPublic: isMonitorPublic(m.id, m.audience === "public", vis),
      })),
    };
  }

  try {
    const body = new URLSearchParams({
      api_key: apiKey,
      format: "json",
      logs: "0",
      custom_uptime_ratios: "30",
      response_times: "1",
      response_times_limit: String(RESPONSE_TIMES_LIMIT),
    });
    const res = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        configured: true,
        overall: "unknown",
        checkedAt,
        monitors: [],
        error: `UptimeRobot HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as {
      stat?: string;
      error?: { message?: string };
      monitors?: RawMonitor[];
    };
    if (json.stat !== "ok" || !Array.isArray(json.monitors)) {
      return {
        configured: true,
        overall: "unknown",
        checkedAt,
        monitors: [],
        error: json.error?.message || "UptimeRobot request failed",
      };
    }

    const monitors = mapMonitors(json.monitors, vis);
    const result: UptimeStatusResult = {
      configured: true,
      overall: overallFrom(monitors),
      checkedAt,
      monitors,
    };
    cache = { at: Date.now(), result, visKey: vKey };
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "UptimeRobot fetch failed";
    return {
      configured: true,
      overall: "unknown",
      checkedAt,
      monitors: [],
      error: message,
    };
  }
}

/** All monitors (super-admin). */
export async function getUptimeStatus(): Promise<UptimeStatusResult> {
  return fetchAllMonitors();
}

/** Public landing + in-app user status — isPublic only. */
export async function getPublicUptimeStatus(): Promise<UptimeStatusResult> {
  const full = await fetchAllMonitors();
  const monitors = full.monitors.filter((m) => m.isPublic);
  return {
    ...full,
    monitors,
    overall: overallFrom(monitors),
  };
}

export type CreateMonitorInput = {
  url: string;
  friendlyName?: string;
  intervalSeconds?: number;
};

export type CreateMonitorResult =
  | { ok: true; id: number; name: string; url: string }
  | { ok: false; error: string };

/** Create an HTTP(s) monitor in UptimeRobot. */
export async function createUptimeMonitor(
  input: CreateMonitorInput,
): Promise<CreateMonitorResult> {
  const { apiKey, ok } = cfg();
  if (!ok) return { ok: false, error: "UPTIMEROBOT_API_KEY is not set" };

  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "URL must be http or https" };
  }

  const friendlyName =
    input.friendlyName?.trim() ||
    (url.pathname && url.pathname !== "/"
      ? `${url.hostname}${url.pathname}`
      : url.hostname);

  const interval = Math.min(
    Math.max(input.intervalSeconds ?? 300, 60),
    3600,
  );

  try {
    const body = new URLSearchParams({
      api_key: apiKey,
      format: "json",
      type: "1", // HTTP(s)
      url: url.toString(),
      friendly_name: friendlyName,
      interval: String(interval),
    });
    const res = await fetch("https://api.uptimerobot.com/v2/newMonitor", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as {
      stat?: string;
      error?: { message?: string };
      monitor?: { id: number; friendly_name?: string; url?: string };
    };
    if (json.stat !== "ok" || !json.monitor?.id) {
      return {
        ok: false,
        error: json.error?.message || `UptimeRobot create failed (HTTP ${res.status})`,
      };
    }
    invalidateUptimeCache();
    return {
      ok: true,
      id: json.monitor.id,
      name: json.monitor.friendly_name || friendlyName,
      url: json.monitor.url || url.toString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create monitor failed",
    };
  }
}
