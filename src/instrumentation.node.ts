/**
 * Node-only startup. Loaded via require() from instrumentation.ts so the Edge
 * instrumentation webpack pass never traces this graph (sharp / fs / etc.).
 */
import { startReportSweeper } from "@/lib/report-sweeper";
import { startMigrationAutoResume } from "@/server/storage-migration";

if (process.env.DISABLE_REPORT_SWEEPER !== "1") {
  startReportSweeper();
}

if (process.env.STORAGE_MIGRATION_AUTO !== "off") {
  startMigrationAutoResume();
}
