import { createLogger } from "@/lib/logger";
import { REPORT_SWEEP_INTERVAL_MS } from "@/lib/session-report-policy";

const log = createLogger("report-sweeper");
const ROUND_TWO_PRESENCE_INTERVAL_MS = 10_000;
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
    }
    try {
      const { sweepRoundTwoReports } = await import("@/server/round-two/report");
      const n = await sweepRoundTwoReports();
      if (n > 0) log.info(`Sweep: ${n} round 2 report(s) generated`);
    } catch (err) {
      log.error("Round 2 report sweep failed:", err);
    }
    try {
      const { pruneAiRuns } = await import("@/lib/ai/graph/runtime");
      await pruneAiRuns();
    } catch (err) {
      log.error("ai_runs prune failed:", err);
    } finally {
      running = false;
    }
  };
  // Round 2 presence: end a round whose room has been empty for the grace period (default 30 s),
  // so it needs a much shorter tick than the report sweep.
  let checkingPresence = false;
  const presence = async () => {
    if (checkingPresence) return;
    checkingPresence = true;
    try {
      const { sweepRoundTwoPresence } = await import("@/server/round-two/autoclose");
      await sweepRoundTwoPresence();
    } catch (err) {
      log.error("Round 2 presence check failed:", err);
    } finally {
      checkingPresence = false;
    }
  };
  setTimeout(presence, 20_000).unref?.();
  setInterval(presence, ROUND_TWO_PRESENCE_INTERVAL_MS).unref?.();
  // First run after boot settles, then on an interval.
  setTimeout(run, 60_000).unref?.();
  setInterval(run, REPORT_SWEEP_INTERVAL_MS).unref?.();
  log.info("Report sweeper started");
}
