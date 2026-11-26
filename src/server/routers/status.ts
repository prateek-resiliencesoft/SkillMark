/**
 * Logged-in user status — public monitors only (same set as landing).
 */
import { getPublicUptimeStatus } from "@/lib/uptime/client";
import { protectedProcedure, router } from "../trpc";

export const statusRouter = router({
  publicMonitors: protectedProcedure.query(async () => {
    return getPublicUptimeStatus();
  }),
});
