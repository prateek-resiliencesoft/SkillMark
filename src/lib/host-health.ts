/**
 * Server condition read from inside the app process (/proc, cgroup, os).
 * Works without Grafana. Inside Docker, /proc/meminfo, /proc/loadavg and
 * /proc/stat show the whole VPS (they are not namespaced), while the cgroup
 * files show this container's own memory limit/usage. Other containers are
 * not visible without the Docker socket, which we deliberately don't mount.
 */
import os from "node:os";
import { existsSync } from "node:fs";
import { readFile, statfs } from "node:fs/promises";
import {
  cpuPercent,
  parseCgroupLimit,
  parseMeminfo,
  parseProcStatCpu,
} from "@/lib/admin-stats";

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export type HostHealth = {
  sampledAt: string;
  hostname: string;
  platform: string;
  inContainer: boolean;
  cpu: { cores: number; percent: number | null; load1: number; load5: number; load15: number };
  memory: { total: number; used: number; percent: number };
  container: { memoryUsed: number | null; memoryLimit: number | null; percent: number | null };
  disk: { path: string; total: number; used: number; percent: number } | null;
  uptime: { hostSeconds: number; appSeconds: number };
  process: { rss: number; heapUsed: number; node: string };
};

export async function readHostHealth(): Promise<HostHealth> {
  const statA = parseProcStatCpu((await readText("/proc/stat")) ?? "");
  await new Promise((r) => setTimeout(r, 300));
  const statB = parseProcStatCpu((await readText("/proc/stat")) ?? "");
  const cpu = statA && statB ? cpuPercent(statA, statB) : null;

  const mem = parseMeminfo((await readText("/proc/meminfo")) ?? "");
  const total = mem.MemTotal ?? os.totalmem();
  const available = mem.MemAvailable ?? os.freemem();
  const used = Math.max(0, total - available);

  const cgUsed =
    parseCgroupLimit(await readText("/sys/fs/cgroup/memory.current")) ??
    parseCgroupLimit(await readText("/sys/fs/cgroup/memory/memory.usage_in_bytes"));
  const cgLimit =
    parseCgroupLimit(await readText("/sys/fs/cgroup/memory.max")) ??
    parseCgroupLimit(await readText("/sys/fs/cgroup/memory/memory.limit_in_bytes"));

  let disk: HostHealth["disk"] = null;
  try {
    const s = await statfs("/");
    const dTotal = s.blocks * s.bsize;
    const dUsed = dTotal - s.bavail * s.bsize;
    disk = { path: "/", total: dTotal, used: dUsed, percent: dTotal ? (dUsed / dTotal) * 100 : 0 };
  } catch {
    disk = null;
  }

  const [l1, l5, l15] = os.loadavg();
  const pm = process.memoryUsage();

  return {
    sampledAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    inContainer: existsSync("/.dockerenv"),
    cpu: { cores: os.cpus().length || 1, percent: cpu, load1: l1, load5: l5, load15: l15 },
    memory: { total, used, percent: total ? (used / total) * 100 : 0 },
    container: {
      memoryUsed: cgUsed,
      memoryLimit: cgLimit,
      percent: cgUsed != null && cgLimit ? (cgUsed / cgLimit) * 100 : null,
    },
    disk,
    uptime: { hostSeconds: os.uptime(), appSeconds: process.uptime() },
    process: { rss: pm.rss, heapUsed: pm.heapUsed, node: process.version },
  };
}
