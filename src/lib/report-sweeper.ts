import { createLogger } from "@/lib/logger";
import { REPORT_SWEEP_INTERVAL_MS } from "@/lib/session-report-policy";

const log = createLogger("report-sweeper");
const g = globalThis as unknown as { __reportSweeperStarted?: boolean };

/** Starts once per process: picks up ended sessions with no report. */
export function startReportSweeper(): void {
  if (g.__reportSweeperStarted) return;
  g.__reportSweeperStarted = true;
  let running = false;
  let first = true;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { sweepPendingReports } = await import("@/lib/session-report-server");
      const r = await sweepPendingReports();
      const total = r.reports + r.completed + r.abandoned + r.neverStarted + r.expired;
      if (total > 0 || first) {
        log.info(
          `Sweep: ${r.neverStarted} never started → abandoned, ${r.abandoned} idle → abandoned, ${r.completed} idle → completed, ${r.expired} heartbeat expired, ${r.reports} report(s) started`,
        );
      }
      first = false;
    } catch (err) {
      log.error("Report sweep failed:", err);
    } finally {
      running = false;
    }
  };
  // First run after boot settles, then on an interval.
  setTimeout(run, 60_000).unref?.();
  setInterval(run, REPORT_SWEEP_INTERVAL_MS).unref?.();
  log.info("Report sweeper started");
}
