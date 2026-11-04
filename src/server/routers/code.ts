import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import { getCodeRunner, CodeRunnerError } from "../code-runner";
import { recordSessionError } from "@/lib/session-error-log-server";
import { redactSecrets } from "@/lib/session-error-log";
import { getLanguage } from "@/lib/code-languages";

const MAX_CODE_BYTES = 64 * 1024;
const MAX_STDIN_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12; // runs per minute per session / user

const hits = new Map<string, number[]>();
function allowRun(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return true;
}

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

export const codeRouter = router({
  /** Which languages can actually be executed right now. */
  runtimes: publicProcedure.query(() => {
    const runner = getCodeRunner();
    return { configured: runner.isConfigured(), provider: runner.name };
  }),

  /**
   * Execute code. Allowed for signed-in users (question builder / previews) or for an in-progress
   * interview session (candidates). The provider key never leaves the server.
   */
  run: publicProcedure
    .input(
      z.object({
        language: z.string().min(1).max(32),
        code: z.string().min(1),
        stdin: z.string().optional(),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let sessionId: string | null = null;
      if (input.sessionId) {
        const { data: s } = await ctx.supabase
          .from("sessions")
          .select("id,status")
          .eq("id", input.sessionId)
          .maybeSingle();
        if (s && (s as { status?: string }).status === "IN_PROGRESS") sessionId = (s as { id: string }).id;
      }
      if (!sessionId && !ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in or join an active interview to run code." });

      if (byteLen(input.code) > MAX_CODE_BYTES) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Code is too large to run (max 64 KB)." });
      if (input.stdin && byteLen(input.stdin) > MAX_STDIN_BYTES) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Input is too large (max 16 KB)." });

      const lang = getLanguage(input.language);
      const runner = getCodeRunner();
      if (!lang || !runner.supports(lang.id)) throw new TRPCError({ code: "BAD_REQUEST", message: `Running ${input.language} is not supported.` });

      const rateKey = sessionId ? `s:${sessionId}` : `u:${(ctx.user as { id?: string } | null)?.id ?? "anon"}`;
      if (!allowRun(rateKey)) {
        if (sessionId) {
          void recordSessionError({
            sessionId,
            category: "rate_limit",
            severity: "warning",
            source: "code-runner",
            message: `Code run rate limit hit (${RATE_MAX}/min).`,
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
      }
    }),
});
