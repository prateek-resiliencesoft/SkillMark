/**
 * Next.js startup hook. Starts the background report pick-up so ended
 * interviews get their report even if nobody opens the dashboard.
 *
 * Edge also evaluates this file. Use require() inside the nodejs branch so
 * webpack DCE drops it for Edge and never follows the Node-only import graph
 * (dynamic import() would still be traced and break the build on sharp/fs).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./instrumentation.node");
  }
}
