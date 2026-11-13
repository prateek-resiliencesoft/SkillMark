/**
 * Next.js startup hook. Starts the background report pick-up so ended
 * interviews get their report even if nobody opens the dashboard.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_REPORT_SWEEPER === "1") return;
  const { startReportSweeper } = await import("@/lib/report-sweeper");
  startReportSweeper();
}
