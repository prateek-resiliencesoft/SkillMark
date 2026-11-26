import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import { getCodeRunner, CodeRunnerError } from "../code-runner";
import { recordSessionError } from "@/lib/session-error-log-server";
import { redactSecrets } from "@/lib/session-error-log";
import { getLanguage } from "@/lib/code-languages";
import { readSessionCapabilityCookie, sessionCapabilityOk } from "@/lib/session-capability";
import { roundTwoRunAllowed } from "@/lib/round-two/boards";
import { hashRoundToken } from "../round-two/access";
import { CODE_RUN_LIMITS, codeRunSessionAllowed, createCodeRunLimiter, type CodeRunSessionRow } from "../code-runner/limits";

const MAX_CODE_BYTES = 64 * 1024;
const MAX_STDIN_BYTES = 16 * 1024;

const limiter = createCodeRunLimiter();

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

export const codeRouter = router({
  /** Which languages can actually be executed right now. */
  runtimes: publicProcedure.query(() => {
    const runner = getCodeRunner();
    return { configured: runner.isConfigured(), provider: runner.name };
  }),

  /**
   * Execute code. Allowed for signed-in users (question builder / previews, round 2 panel), for an
   * in-progress interview session (candidates), or for the admitted candidate of a live round 2
   * (by their link token). The provider key never leaves the server.
   */
  run: publicProcedure
    .input(
      z.object({
        language: z.string().min(1).max(32),
        code: z.string().min(1).max(MAX_CODE_BYTES),
        stdin: z.string().max(MAX_STDIN_BYTES).optional(),
        sessionId: z.string().uuid().optional(),
        /** Round 2 candidate link token (no login). */
        roundTwo: z.object({ token: z.string().min(10).max(200) }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (byteLen(input.code) > MAX_CODE_BYTES) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Code is too large to run (max 64 KB)." });
      if (input.stdin && byteLen(input.stdin) > MAX_STDIN_BYTES) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Input is too large (max 16 KB)." });

      let sessionId: string | null = null;
      let organizationId: string | null = null;
      if (input.sessionId) {
        const { data } = await ctx.supabase
          .from("sessions")
          .select('id, status, "interviewBeganAt", "capabilityRequired", interview:interviews!inner(project:projects(organizationId))')
          .eq("id", input.sessionId)
          .maybeSingle();
        const s = data as (CodeRunSessionRow & { interview?: { project?: { organizationId?: string | null } | null } | null }) | null;
        if (codeRunSessionAllowed(s) && s) {
          const token = s.capabilityRequired ? await readSessionCapabilityCookie(s.id) : null;
          if (sessionCapabilityOk(s, token)) {
            sessionId = s.id;
            organizationId = s.interview?.project?.organizationId ?? null;
          }
        }
      }
      let roundTwoId: string | null = null;
      if (!sessionId && input.roundTwo) {
        const { data } = await ctx.supabase
          .from("round_two_interviews")
          .select('id, status, "candidateAdmittedAt", "organizationId"')
          .eq("candidateTokenHash", hashRoundToken(input.roundTwo.token))
          .maybeSingle();
        if (data && roundTwoRunAllowed(data)) {
          roundTwoId = data.id as string;
          organizationId = (data.organizationId as string | null) ?? null;
        }
      }
      const userId = (ctx.user as { id?: string } | null)?.id ?? null;
      if (!sessionId && !roundTwoId && !userId) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in or join an active interview to run code." });

      const lang = getLanguage(input.language);
      const runner = getCodeRunner();
      if (!lang || !runner.supports(lang.id)) throw new TRPCError({ code: "BAD_REQUEST", message: `Running ${input.language} is not supported.` });

      // A round 2 candidate gets the same per-session limits, keyed by the round.
      const slot = limiter.acquire({ sessionId: sessionId ?? (roundTwoId ? `r2:${roundTwoId}` : null), userId, organizationId });
      if (!slot.ok) {
        if (sessionId && slot.reason === "s") {
          void recordSessionError({
            sessionId,
            category: "rate_limit",
            severity: "warning",
            source: "code-runner",
            message: `Code run rate limit hit (${slot.reason}; ${CODE_RUN_LIMITS.perSessionPerMinute}/min per session).`,
            status: 429,
            code: "RUN_RATE_LIMITED",
            context: { language: lang.id },
          });
        }
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many runs. Wait a few seconds and try again." });
      }

      try {
        const result = await runner.run({ language: lang.id, code: input.code, stdin: input.stdin, timeLimitSec: 10 });
        return { ...result, languageLabel: `${lang.label} ${lang.version}` };
      } catch (err) {
        const e = err instanceof CodeRunnerError ? err : new CodeRunnerError(redactSecrets(err), 500, "UNKNOWN");
        if (sessionId) {
          void recordSessionError({
            sessionId,
            category: e.status === 429 ? "rate_limit" : "other",
            severity: e.status === 429 ? "warning" : "error",
            source: "code-runner",
            message: redactSecrets(e.message),
            status: e.status ?? null,
            code: e.code ?? null,
            context: { language: lang.id, provider: runner.name },
          });
        } else {
          console.error("[code-runner]", e.status, e.code, redactSecrets(e.message));
        }
        const code =
          e.status === 429 ? "TOO_MANY_REQUESTS" : e.code === "NOT_CONFIGURED" ? "PRECONDITION_FAILED" : e.status === 504 ? "TIMEOUT" : "INTERNAL_SERVER_ERROR";
        throw new TRPCError({
          code,
          message:
            e.code === "AUTH"
              ? "The code runner rejected the server's API key."
              : e.status === 429
                ? "The code runner is busy (rate limit). Try again shortly."
                : e.message,
        });
      } finally {
        slot.release();
      }
    }),
});
