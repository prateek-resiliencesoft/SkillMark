/**
 * Grafana Cloud service-account → Loki via datasource proxy
 * (super-admin /admin/server-logs).
 *
 * Env:
 *   GRAFANA_URL                      https://grayparlor153.grafana.net
 *   GRAFANA_SERVICE_ACCOUNT_TOKEN    glsa_…
 *   GRAFANA_LOKI_DATASOURCE_UID      grafanacloud-logs (default)
 *   GRAFANA_LOG_INSTANCE             resiliencesoft-interview-ai (default)
 */

export type GrafanaLogSource =
  | "all"
  | "syslog"
  | "auth"
  | "kern"
  | "ufw"
  | "dpkg";

export const GRAFANA_LOG_SOURCES: {
  id: GrafanaLogSource;
  label: string;
  filename?: string;
}[] = [
  { id: "all", label: "All system logs" },
  { id: "syslog", label: "Syslog", filename: "/var/log/syslog" },
  { id: "auth", label: "Auth", filename: "/var/log/auth.log" },
  { id: "kern", label: "Kernel", filename: "/var/log/kern.log" },
  { id: "ufw", label: "Firewall (UFW)", filename: "/var/log/ufw.log" },
  { id: "dpkg", label: "Packages", filename: "/var/log/dpkg.log" },
];

export type GrafanaLogEntry = {
  timestamp: string;
  line: string;
  filename: string | null;
  instance: string | null;
  job: string | null;
  level: "error" | "warn" | "info" | "debug" | "unknown";
};

export type GrafanaLogsResult = {
  configured: boolean;
  entries: GrafanaLogEntry[];
  query: string;
  grafanaExploreUrl: string | null;
  error?: string;
};

function cfg() {
  const url = (process.env.GRAFANA_URL || "").replace(/\/$/, "");
  const token = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN || "";
  const lokiUid = process.env.GRAFANA_LOKI_DATASOURCE_UID || "grafanacloud-logs";
  const instance = process.env.GRAFANA_LOG_INSTANCE || "skillmark";
  return { url, token, lokiUid, instance, ok: !!(url && token) };
}

function escapeLabel(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildLogQL(opts: {
  instance: string;
  source: GrafanaLogSource;
  search?: string;
}) {
  const meta = GRAFANA_LOG_SOURCES.find((s) => s.id === opts.source);
  const labels = [`instance="${escapeLabel(opts.instance)}"`, `job="integrations/node_exporter"`];
  if (meta?.filename) labels.push(`filename="${escapeLabel(meta.filename)}"`);
  let q = `{${labels.join(", ")}}`;
  const search = opts.search?.trim();
  if (search) {
    const safe = search.replace(/[\\"]/g, "\\$&");
    q += ` |~ "(?i)${safe}"`;
  }
  return q;
}

function detectLevel(line: string): GrafanaLogEntry["level"] {
  if (/\b(ERROR|CRIT|CRITICAL|FATAL|EMERG|panic)\b/i.test(line)) return "error";
  if (/\b(WARN|WARNING|UFW BLOCK)\b/i.test(line)) return "warn";
  if (/\b(DEBUG|TRACE)\b/i.test(line)) return "debug";
  if (/\b(INFO|NOTICE)\b/i.test(line)) return "info";
  return "unknown";
}

function nsToIso(ns: string): string {
  const n = BigInt(ns.replace(/"/g, ""));
  const ms = Number(n / 1_000_000n);
  return new Date(ms).toISOString();
}

export function grafanaExploreUrl(logql: string, fromMs: number, toMs: number): string | null {
  const { url, lokiUid, ok } = cfg();
  if (!ok) return null;
  const panes = {
    abc: {
      datasource: lokiUid,
      queries: [{ refId: "A", expr: logql, queryType: "range" }],
      range: { from: String(fromMs), to: String(toMs) },
    },
  };
  const params = new URLSearchParams({
    schemaVersion: "1",
    panes: JSON.stringify(panes),
    orgId: "1",
  });
  return `${url}/explore?${params.toString()}`;
}

export async function queryGrafanaLinuxLogs(input: {
  source?: GrafanaLogSource;
  search?: string;
  minutes?: number;
  limit?: number;
}): Promise<GrafanaLogsResult> {
  const { url, token, lokiUid, instance, ok } = cfg();
  const source = input.source ?? "all";
  const minutes = Math.min(Math.max(input.minutes ?? 60, 5), 60 * 24 * 7);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const logql = buildLogQL({ instance, source, search: input.search });
  const end = Date.now();
  const start = end - minutes * 60_000;
  const explore = grafanaExploreUrl(logql, start, end);

  if (!ok) {
    return {
      configured: false,
      entries: [],
      query: logql,
      grafanaExploreUrl: null,
      error:
        "Grafana is not configured. Set GRAFANA_URL and GRAFANA_SERVICE_ACCOUNT_TOKEN on the server.",
    };
  }

  const qs = new URLSearchParams({
    query: logql,
    start: String(start * 1_000_000),
    end: String(end * 1_000_000),
    limit: String(limit),
    direction: "backward",
  });

  const endpoint = `${url}/api/datasources/proxy/uid/${encodeURIComponent(lokiUid)}/loki/api/v1/query_range?${qs}`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      return {
        configured: true,
        entries: [],
        query: logql,
        grafanaExploreUrl: explore,
        error: `Grafana Loki ${res.status}: ${body || res.statusText}`,
      };
    }

    const json = (await res.json()) as {
      data?: {
        result?: { stream?: Record<string, string>; values?: [string, string][] }[];
      };
    };

    const entries: GrafanaLogEntry[] = [];
    for (const stream of json.data?.result ?? []) {
      const labels = stream.stream ?? {};
      for (const [ts, line] of stream.values ?? []) {
        entries.push({
          timestamp: nsToIso(ts),
          line,
          filename: labels.filename ?? null,
          instance: labels.instance ?? null,
          job: labels.job ?? null,
          level: detectLevel(line),
        });
      }
    }

    entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    return {
      configured: true,
      entries: entries.slice(0, limit),
      query: logql,
      grafanaExploreUrl: explore,
    };
  } catch (err) {
    return {
      configured: true,
      entries: [],
      query: logql,
      grafanaExploreUrl: explore,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
