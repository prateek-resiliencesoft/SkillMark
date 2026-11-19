/**
 * Superadmin Error Logs: grouped interview errors across all organizations,
 * plus acknowledge / resolve per error group. Admin-only (platformProcedure).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { GROUP_STATUSES, MAX_REPORT_RANGE_MS } from "@/lib/error-log-report";
import { ERROR_CATEGORIES, ERROR_SEVERITIES } from "@/lib/session-error-log";
import { loadErrorLogReport, setErrorGroupStatus } from "../error-logs";
import { writePlatformAudit } from "../tenant";
import { platformProcedure, router } from "../trpc";

const rangeInput = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    category: z.enum(ERROR_CATEGORIES).optional(),
    severity: z.enum(ERROR_SEVERITIES).optional(),
    organizationId: z.string().uuid().optional(),
    status: z.enum(GROUP_STATUSES).optional(),
    search: z.string().max(200).optional(),
    page: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(10).max(200).default(50),
  })
  .superRefine((v, ctx) => {
    const span = Date.parse(v.to) - Date.parse(v.from);
    if (!(span > 0)) ctx.addIssue({ code: "custom", message: "`to` must be after `from`.", path: ["to"] });
    else if (span > MAX_REPORT_RANGE_MS) ctx.addIssue({ code: "custom", message: "Range can be at most 31 days.", path: ["from"] });
  });

export const errorLogsRouter = router({
  /** Ranked error groups, time series, and the raw event page for the range. */
  report: platformProcedure.input(rangeInput).query(({ ctx, input }) =>
    loadErrorLogReport(ctx.supabase, {
      from: new Date(input.from).toISOString(),
      to: new Date(input.to).toISOString(),
      filters: {
        category: input.category,
        severity: input.severity,
        organizationId: input.organizationId,
        status: input.status,
        search: input.search,
      },
      page: input.page,
      pageSize: input.pageSize,
    }),
  ),

  /** Acknowledge, resolve, or reopen an error group, with an optional note. */
  setGroupStatus: platformProcedure
    .input(
      z.object({
        signature: z.string().regex(/^[0-9a-f]{16}$/),
        status: z.enum(GROUP_STATUSES),
        note: z.string().max(500).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const saved = await setErrorGroupStatus(ctx.supabase, {
          signature: input.signature,
          status: input.status,
          note: input.note?.trim() || null,
          actorId: ctx.user.id,
        });
        await writePlatformAudit(ctx.supabase, {
          actorId: ctx.user.id,
          action: "error_log.status_change",
          targetType: "error_log_group",
          targetId: input.signature,
          meta: { status: input.status },
        });
        return saved;
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Could not update status." });
      }
    }),
});
