/**
 * Node-only startup. Loaded via require() from instrumentation.ts so the Edge
 * instrumentation webpack pass never traces this graph (sharp / fs / etc.).
 */
import { startLangfuseTracing } from "@/lib/ai/otel";
import { startReportSweeper } from "@/lib/report-sweeper";

try {
  startLangfuseTracing();
} catch (err) {
  console.error("[instrumentation] Langfuse tracing failed to start", err);
}

if (process.env.DISABLE_REPORT_SWEEPER !== "1") {
  startReportSweeper();
}
