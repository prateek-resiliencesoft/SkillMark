import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { countOrgSeats, loadOrgLimits } from "../quotas";
import { requireOrgAccess } from "../tenant";

const periodEnum = z.enum([
  "current",
  "last7",
  "last30",
  "last90",
  "thisMonth",
]);

type Period = z.infer<typeof periodEnum>;

const filterInput = z.object({
  organizationId: z.string().optional(),
  period: periodEnum.optional(),
  projectId: z.string().optional(),
  tzOffset: z.number().optional(),
});

function toLocalDate(iso: string, tzOffset = 0): string {
  const ms = new Date(iso).getTime() - tzOffset * 60_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Resolve a usable org id for the caller.
 * When the client passes organizationId, membership is required (no IDOR).
 */
async function resolveOrgId(
  supabase: typeof supabaseAdmin,
  userId: string,
  orgId?: string,
) {
  if (orgId) {
    await requireOrgAccess(supabase, orgId, userId, { minRole: "VIEWER" });
    return orgId;
  }
  const { data } = await supabase
    .from("organization_members")
    .select("organizationId")
    .eq("userId", userId)
    .limit(1)
    .maybeSingle();
  return data?.organizationId ?? undefined;
}

function resolveCalendarPeriod(period: Period | undefined): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "last7": {
      const s = new Date(now);
      s.setDate(s.getDate() - 7);
      return { start: s, end: now };
    }
    case "last30": {
      const s = new Date(now);
      s.setDate(s.getDate() - 30);
      return { start: s, end: now };
    }
    case "last90": {
      const s = new Date(now);
      s.setDate(s.getDate() - 90);
      return { start: s, end: now };
    }
    case "thisMonth":
    default: {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: now,
      };
    }
  }
}

async function getProjectIds(orgId: string, projectId?: string): Promise<string[]> {
  if (projectId) return [projectId];
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("organizationId", orgId);
  return (data ?? []).map((p) => p.id);
}

async function getInterviewIds(projectIds: string[]): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("interviews")
    .select("id")
    .in("projectId", projectIds);
  return (data ?? []).map((i) => i.id);
}

export const usageRouter = router({
  summary: protectedProcedure
    .input(filterInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = await resolveOrgId(
        ctx.supabase,
        userId,
        input.organizationId,
      );

      const range = resolveCalendarPeriod(input.period);

      // --- Templates ---
      let templatesUsed = 0;
      if (orgId) {
        const pIds = await getProjectIds(orgId, input.projectId);
        if (pIds.length > 0) {
          const { count } = await supabaseAdmin
            .from("interviews")
            .select("id", { count: "exact", head: true })
            .in("projectId", pIds)
            .gte("createdAt", range.start.toISOString())
            .lte("createdAt", range.end.toISOString());
          templatesUsed = count ?? 0;
        }
      }

      // --- Session Time ---
      let sessionSecondsUsed = 0;
      if (orgId) {
        const pIds = await getProjectIds(orgId, input.projectId);
        const iIds = await getInterviewIds(pIds);
        if (iIds.length > 0) {
          const { data: sessions } = await supabaseAdmin
            .from("sessions")
            .select("totalDurationSeconds")
            .in("interviewId", iIds)
            .gte("createdAt", range.start.toISOString())
            .lte("createdAt", range.end.toISOString());
          sessionSecondsUsed = (sessions ?? []).reduce(
            (sum, s) => sum + ((s.totalDurationSeconds as number) ?? 0),
            0,
          );
        }
      }

      // --- Seats (members + pending invites) ---
      let seatsUsed = 1;
      if (orgId) {
        seatsUsed = await countOrgSeats(ctx.supabase, orgId);
      }

      // --- Daily breakdowns ---
      const days: string[] = [];
      const d = new Date(range.start);
      while (d <= range.end) {
        days.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }

      const tz = input.tzOffset ?? 0;

      // Sessions per day (duration)
      const sessionsByDay: Record<string, number> = {};
      if (orgId) {
        const pIds = await getProjectIds(orgId, input.projectId);
        const iIds = await getInterviewIds(pIds);
        if (iIds.length > 0) {
          const { data: allSessions } = await supabaseAdmin
            .from("sessions")
            .select("totalDurationSeconds, createdAt")
            .in("interviewId", iIds)
            .gte("createdAt", range.start.toISOString())
            .lte("createdAt", range.end.toISOString());
          for (const s of allSessions ?? []) {
            const day = toLocalDate(s.createdAt as string, tz);
            sessionsByDay[day] = (sessionsByDay[day] ?? 0) + ((s.totalDurationSeconds as number) ?? 0);
          }
        }
      }

      // Templates created per day
      const templatesByDay: Record<string, number> = {};
      if (orgId) {
        const pIds = await getProjectIds(orgId, input.projectId);
        if (pIds.length > 0) {
          const { data: allInterviews } = await supabaseAdmin
            .from("interviews")
            .select("createdAt")
            .in("projectId", pIds)
            .gte("createdAt", range.start.toISOString())
            .lte("createdAt", range.end.toISOString());
          for (const iv of allInterviews ?? []) {
            const day = toLocalDate(iv.createdAt as string, tz);
            templatesByDay[day] = (templatesByDay[day] ?? 0) + 1;
          }
        }
      }

      const daily = days.map((day) => ({
        date: day,
        aiTokens: 0,
        sessionMinutes: Math.round((sessionsByDay[day] ?? 0) / 60),
        templates: templatesByDay[day] ?? 0,
      }));

      let seatsLimit: number | null = null;
      let interviewsLimit: number | null = null;
      let plan: string = "SELF_HOSTED";
      if (orgId) {
        const resolved = await loadOrgLimits(ctx.supabase, orgId);
        plan = resolved.plan;
        seatsLimit = resolved.limits.seats;
        interviewsLimit = resolved.limits.interviews;
      }

      return {
        periodStart: range.start.toISOString(),
        periodEnd: range.end.toISOString(),
        plan,
        templates: {
          used: templatesUsed,
          limit: interviewsLimit,
        },
        sessionTime: {
          usedSeconds: sessionSecondsUsed,
          limit: null as number | null,
        },
        seats: {
          used: seatsUsed,
          limit: seatsLimit,
        },
        daily,
      };
    }),

  tokenTransactions: protectedProcedure
    .input(filterInput)
    .query(async () => {
      return [];
    }),

  sessionTransactions: protectedProcedure
    .input(filterInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = await resolveOrgId(
        ctx.supabase,
        userId,
        input.organizationId,
      );
      if (!orgId) return [];

      const range = resolveCalendarPeriod(input.period);

      const pIds = await getProjectIds(orgId, input.projectId);
      const iIds = await getInterviewIds(pIds);
      if (iIds.length === 0) return [];

      const { data: sessions } = await supabaseAdmin
        .from("sessions")
        .select("id, interviewId, participantName, participantEmail, totalDurationSeconds, status, createdAt")
        .in("interviewId", iIds)
        .gte("createdAt", range.start.toISOString())
        .lte("createdAt", range.end.toISOString())
        .order("createdAt", { ascending: false })
        .limit(200);

      const uniqueIvIds = Array.from(new Set((sessions ?? []).map((s) => s.interviewId as string)));
      const ivTitleMap: Record<string, string> = {};
      if (uniqueIvIds.length > 0) {
        const { data: ivs } = await supabaseAdmin
          .from("interviews")
          .select("id, title")
          .in("id", uniqueIvIds);
        for (const iv of ivs ?? []) {
          ivTitleMap[iv.id as string] = iv.title as string;
        }
      }

      return (sessions ?? []).map((s) => ({
        id: s.id as string,
        interviewTitle: ivTitleMap[s.interviewId as string] ?? "Unknown",
        participant: (s.participantName as string) || (s.participantEmail as string) || "Anonymous",
        durationSeconds: (s.totalDurationSeconds as number) ?? 0,
        status: s.status as string,
        createdAt: s.createdAt as string,
      }));
    }),

  templateTransactions: protectedProcedure
    .input(filterInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const orgId = await resolveOrgId(
        ctx.supabase,
        userId,
        input.organizationId,
      );
      if (!orgId) return [];

      const range = resolveCalendarPeriod(input.period);

      const pIds = await getProjectIds(orgId, input.projectId);
      if (pIds.length === 0) return [];

      const { data: projects } = await supabaseAdmin
        .from("projects")
        .select("id, name")
        .in("id", pIds);
      const projNameMap: Record<string, string> = {};
      for (const p of projects ?? []) {
        projNameMap[p.id as string] = p.name as string;
      }

      const { data: interviews } = await supabaseAdmin
        .from("interviews")
        .select("id, title, projectId, chatEnabled, voiceEnabled, videoEnabled, createdAt")
        .in("projectId", pIds)
        .gte("createdAt", range.start.toISOString())
        .lte("createdAt", range.end.toISOString())
        .order("createdAt", { ascending: false })
        .limit(200);

      const ivIds = (interviews ?? []).map((i) => i.id as string);
      const sessionCounts: Record<string, number> = {};
      if (ivIds.length > 0) {
        const { data: sessions } = await supabaseAdmin
          .from("sessions")
          .select("interviewId")
          .in("interviewId", ivIds);
        for (const s of sessions ?? []) {
          const key = s.interviewId as string;
          sessionCounts[key] = (sessionCounts[key] ?? 0) + 1;
        }
      }

      return (interviews ?? []).map((iv) => {
        const channels: string[] = [];
        if (iv.chatEnabled) channels.push("Chat");
        if (iv.voiceEnabled) channels.push("Voice");
        if (iv.videoEnabled) channels.push("Video");
        return {
          id: iv.id as string,
          title: iv.title as string,
          projectName: projNameMap[iv.projectId as string] ?? "Unknown",
          channels: channels.length > 0 ? channels : ["Chat"],
          sessionCount: sessionCounts[iv.id as string] ?? 0,
          createdAt: iv.createdAt as string,
        };
      });
    }),
});
