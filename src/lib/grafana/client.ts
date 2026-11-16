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

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const attempts: string[] = [];

  // 1) Classic datasource proxy (fast, raw Loki JSON).
  // 2) If that fails (Grafana Cloud returns 503 DatasourceError when the proxy
  //    cannot reach the managed Loki), use the unified /api/ds/query API.
  // 3) If the configured UID is wrong, look up the Loki datasource by type.
  const uids = [lokiUid];
  for (let i = 0; i < uids.length; i++) {
    const uid = uids[i];
    try {
      const res = await fetch(
        `${url}/api/datasources/proxy/uid/${encodeURIComponent(uid)}/loki/api/v1/query_range?${qs}`,
        { headers, signal: AbortSignal.timeout(20_000), cache: "no-store" },
      );
      if (res.ok) {
        const json = (await res.json()) as LokiProxyResponse;
        return {
          configured: true,
          entries: finishEntries(parseLokiProxy(json), limit),
          query: logql,
          grafanaExploreUrl: explore,
        };
      }
      attempts.push(`proxy ${uid}: ${res.status} ${(await res.text()).slice(0, 160)}`);
    } catch (err) {
      attempts.push(`proxy ${uid}: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const res = await fetch(`${url}/api/ds/query`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: [
            {
              refId: "A",
              datasource: { uid, type: "loki" },
              expr: logql,
              queryType: "range",
              maxLines: limit,
              direction: "backward",
            },
          ],
          from: String(start),
          to: String(end),
        }),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (res.ok) {
        const json = (await res.json()) as DsQueryResponse;
        const frameError = json.results?.A?.error;
        if (!frameError) {
          return {
            configured: true,
            entries: finishEntries(parseDsQueryFrames(json), limit),
            query: logql,
            grafanaExploreUrl: explore,
          };
        }
        attempts.push(`ds/query ${uid}: ${String(frameError).slice(0, 160)}`);
      } else {
        attempts.push(`ds/query ${uid}: ${res.status} ${(await res.text()).slice(0, 160)}`);
      }
    } catch (err) {
      attempts.push(`ds/query ${uid}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (i === 0) {
      const found = await discoverLokiUids(url, headers);
      for (const f of found) if (!uids.includes(f)) uids.push(f);
    }
  }

  return {
    configured: true,
    entries: [],
    query: logql,
    grafanaExploreUrl: explore,
    error: lokiErrorMessage(attempts, lokiUid),
  };
}

type LokiProxyResponse = {
  data?: {
    result?: { stream?: Record<string, string>; values?: [string, string][] }[];
  };
};

type DsQueryField = {
  name?: string;
  type?: string;
  labels?: Record<string, string>;
};
type DsQueryFrame = {
  schema?: { fields?: DsQueryField[] };
  data?: { values?: unknown[][] };
};
export type DsQueryResponse = {
  results?: Record<string, { error?: string; frames?: DsQueryFrame[] }>;
};

function finishEntries(entries: GrafanaLogEntry[], limit: number) {
  entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return entries.slice(0, limit);
}

export function parseLokiProxy(json: LokiProxyResponse): GrafanaLogEntry[] {
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
  return entries;
}

/** Parse Loki data frames returned by Grafana's /api/ds/query. */
export function parseDsQueryFrames(json: DsQueryResponse): GrafanaLogEntry[] {
  const entries: GrafanaLogEntry[] = [];
  for (const result of Object.values(json.results ?? {})) {
    for (const frame of result.frames ?? []) {
      const fields = frame.schema?.fields ?? [];
      const values = frame.data?.values ?? [];
      const idx = (pred: (f: DsQueryField) => boolean) => fields.findIndex(pred);
      const lineIdx = idx((f) => /^(line|body)$/i.test(f.name ?? ""));
      const lineAlt = lineIdx >= 0 ? lineIdx : idx((f) => f.type === "string" && !/^(id|labels|tsNs)$/i.test(f.name ?? ""));
      const timeIdx = idx((f) => f.type === "time" || /^(time|timestamp)$/i.test(f.name ?? ""));
      const nsIdx = idx((f) => f.name === "tsNs");
      const labelsIdx = idx((f) => f.name === "labels");
      if (lineAlt < 0) continue;
      const lines = (values[lineAlt] ?? []) as unknown[];
      const fieldLabels = fields[lineAlt]?.labels ?? {};
      for (let r = 0; r < lines.length; r++) {
        const line = String(lines[r] ?? "");
        let ts: string;
        const ns = nsIdx >= 0 ? values[nsIdx]?.[r] : undefined;
        const t = timeIdx >= 0 ? values[timeIdx]?.[r] : undefined;
        if (typeof ns === "string" && /^\d+$/.test(ns)) ts = nsToIso(ns);
        else if (typeof t === "number") ts = new Date(t).toISOString();
        else ts = new Date().toISOString();
        const rowLabels =
          labelsIdx >= 0 && values[labelsIdx]?.[r] && typeof values[labelsIdx][r] === "object"
            ? (values[labelsIdx][r] as Record<string, string>)
            : fieldLabels;
        entries.push({
          timestamp: ts,
          line,
          filename: rowLabels.filename ?? null,
          instance: rowLabels.instance ?? null,
          job: rowLabels.job ?? null,
          level: detectLevel(line),
        });
      }
    }
  }
  return entries;
}

async function discoverLokiUids(url: string, headers: Record<string, string>): Promise<string[]> {
  try {
    const res = await fetch(`${url}/api/datasources`, {
      headers,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const list = (await res.json()) as { uid?: string; type?: string }[];
    return (Array.isArray(list) ? list : [])
      .filter((d) => d.type === "loki" && d.uid)
      .map((d) => d.uid as string);
  } catch {
    return [];
  }
}

/** Plain explanation of why logs could not be read. Never includes the token. */
export function lokiErrorMessage(attempts: string[], configuredUid: string): string {
  const joined = attempts.join(" | ");
  let hint = "";
  if (/\b401\b|\b403\b|permission|unauthori[sz]ed/i.test(joined)) {
    hint = "The Grafana service account token is missing permission to query logs (needs Viewer or datasources:query on the Loki datasource).";
  } else if (/\b404\b|not found/i.test(joined)) {
    hint = `No Loki datasource with uid "${configuredUid}". Set GRAFANA_LOKI_DATASOURCE_UID to the uid shown in Grafana > Connections > Data sources.`;
  } else if (/DatasourceError|\b50[234]\b|communicating/i.test(joined)) {
    hint = "Grafana could not reach its Loki datasource. Usually the datasource's own credentials (Grafana Cloud logs API key) expired or were rotated, or Loki is down. Open the datasource in Grafana and press Save & test.";
  }
  return `Could not read logs from Grafana Loki. ${hint} Details: ${joined}`.trim();
}

/* ------------------------------------------------------------------ */
/*  Metrics (Prometheus datasource via the same service account)       */
/* ------------------------------------------------------------------ */

export type MetricPoint = { t: number; v: number };

export type ServerMetricKey =
  | "cpu"
  | "memory"
  | "memoryUsedBytes"
  | "disk"
  | "load"
  | "netIn"
  | "netOut";

export type ServerMetricsResult = {
  configured: boolean;
  minutes: number;
  stepSeconds: number;
  series: Partial<Record<ServerMetricKey, MetricPoint[]>>;
  memoryTotalBytes: number | null;
  /** Root filesystem size (`mountpoint="/"`). */
  diskTotalBytes: number | null;
  /** Space left on that filesystem. */
  diskFreeBytes: number | null;
  cpuCores: number | null;
  grafanaUrl: string | null;
  error?: string;
};

function metricQueries(instance: string): Record<ServerMetricKey, string> {
  const i = `instance="${escapeLabel(instance)}"`;
  const dev = `device!~"lo|docker.*|veth.*|br-.*"`;
  return {
    cpu: `100 - (avg(rate(node_cpu_seconds_total{${i},mode="idle"}[2m])) * 100)`,
    memory: `(1 - node_memory_MemAvailable_bytes{${i}} / node_memory_MemTotal_bytes{${i}}) * 100`,
    memoryUsedBytes: `node_memory_MemTotal_bytes{${i}} - node_memory_MemAvailable_bytes{${i}}`,
    disk: `100 - (node_filesystem_avail_bytes{${i},mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{${i},mountpoint="/",fstype!="tmpfs"} * 100)`,
    load: `node_load1{${i}}`,
    netIn: `sum(rate(node_network_receive_bytes_total{${i},${dev}}[2m]))`,
    netOut: `sum(rate(node_network_transmit_bytes_total{${i},${dev}}[2m]))`,
  };
}

async function promRange(
  base: string,
  token: string,
  uid: string,
  query: string,
  startSec: number,
  endSec: number,
  step: number,
): Promise<MetricPoint[]> {
  const qs = new URLSearchParams({
    query,
    start: String(startSec),
    end: String(endSec),
    step: String(step),
  });
  const res = await fetch(
    `${base}/api/datasources/proxy/uid/${encodeURIComponent(uid)}/api/v1/query_range?${qs}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Grafana Prometheus ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: { result?: { values?: [number, string][] }[] };
  };
  const values = json.data?.result?.[0]?.values ?? [];
  return values
    .map(([t, v]) => ({ t: t * 1000, v: Number(v) }))
    .filter((p) => Number.isFinite(p.v));
}

async function promInstant(base: string, token: string, uid: string, query: string): Promise<number | null> {
  const res = await fetch(
    `${base}/api/datasources/proxy/uid/${encodeURIComponent(uid)}/api/v1/query?${new URLSearchParams({ query })}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { result?: { value?: [number, string] }[] } };
  const v = Number(json.data?.result?.[0]?.value?.[1]);
  return Number.isFinite(v) ? v : null;
}

/** CPU, memory, disk, load and bandwidth for the app server from node_exporter. */
export async function queryServerMetrics(input: { minutes?: number }): Promise<ServerMetricsResult> {
  const { url, token, instance, ok } = cfg();
  const promUid = process.env.GRAFANA_PROM_DATASOURCE_UID || "grafanacloud-prom";
  const minutes = Math.min(Math.max(input.minutes ?? 60, 5), 60 * 24 * 7);
  const stepSeconds = Math.max(15, Math.ceil((minutes * 60) / 240));
  const empty: ServerMetricsResult = {
    configured: ok,
    minutes,
    stepSeconds,
    series: {},
    memoryTotalBytes: null,
    diskTotalBytes: null,
    diskFreeBytes: null,
    cpuCores: null,
    grafanaUrl: ok ? url : null,
  };
  if (!ok) {
    return {
      ...empty,
      error: "Grafana is not configured. Set GRAFANA_URL and GRAFANA_SERVICE_ACCOUNT_TOKEN on the server.",
    };
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - minutes * 60;
  const queries = metricQueries(instance);
  const keys = Object.keys(queries) as ServerMetricKey[];

  try {
    const disk = `instance="${escapeLabel(instance)}",mountpoint="/",fstype!="tmpfs"`;
    const [results, memTotal, diskTotal, diskFree, cores] = await Promise.all([
      Promise.all(keys.map((k) => promRange(url, token, promUid, queries[k], start, end, stepSeconds))),
      promInstant(url, token, promUid, `node_memory_MemTotal_bytes{instance="${escapeLabel(instance)}"}`),
      promInstant(url, token, promUid, `node_filesystem_size_bytes{${disk}}`),
      promInstant(url, token, promUid, `node_filesystem_avail_bytes{${disk}}`),
      promInstant(
        url,
        token,
        promUid,
        `count(count by (cpu) (node_cpu_seconds_total{instance="${escapeLabel(instance)}"}))`,
      ),
    ]);
    const series: ServerMetricsResult["series"] = {};
    keys.forEach((k, idx) => {
      series[k] = results[idx];
    });
    return {
      ...empty,
      series,
      memoryTotalBytes: memTotal,
      diskTotalBytes: diskTotal,
      diskFreeBytes: diskFree,
      cpuCores: cores,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}
