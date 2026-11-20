/**
 * Node-only startup. Loaded via require() from instrumentation.ts so the Edge
 * instrumentation webpack pass never traces this graph (sharp / fs / etc.).
 */
import { startReportSweeper } from "@/lib/report-sweeper";

if (process.env.DISABLE_REPORT_SWEEPER !== "1") {
  startReportSweeper();
}
