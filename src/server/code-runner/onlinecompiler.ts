import "server-only";
import { getLanguage } from "@/lib/code-languages";
import { CodeRunnerError, type CodeRunRequest, type CodeRunResult, type CodeRunner } from "./types";

const ENDPOINT = "https://api.onlinecompiler.io/api/run-code-sync/";
const REQUEST_TIMEOUT_MS = 40_000; // provider hard limit is 30 s per run (compile + run)

interface OnlineCompilerResponse {
  output?: string;
  error?: string;
  status?: "success" | "error";
  exit_code?: number | null;
  signal?: number | null;
  truncated?: boolean;
  time?: string | null;
  total?: string | null;
  memory?: string | null;
}

const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** OnlineCompiler.io REST API (https://onlinecompiler.io/docs). Key: process.env.CODE_RUNNER_API_KEY (server only). */
export class OnlineCompilerRunner implements CodeRunner {
  readonly name = "onlinecompiler.io";

  private get key() {
    return process.env.CODE_RUNNER_API_KEY?.trim() ?? "";
  }

  isConfigured() {
    return this.key.length > 0;
  }

  supports(language: string) {
    return !!getLanguage(language)?.runnerId;
  }

  async run(req: CodeRunRequest): Promise<CodeRunResult> {
    const compiler = getLanguage(req.language)?.runnerId;
    if (!compiler) throw new CodeRunnerError(`Running ${req.language} is not supported.`, 400, "UNSUPPORTED_LANGUAGE");
    if (!this.isConfigured()) throw new CodeRunnerError("Code execution is not configured on this server.", 503, "NOT_CONFIGURED");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: this.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          compiler,
          code: req.code,
          input: req.stdin ?? "",
          ...(req.timeLimitSec ? { time_limit: Math.min(30, req.timeLimitSec) } : {}),
        }),
        signal: ctrl.signal,
        cache: "no-store",
      });
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      throw new CodeRunnerError(aborted ? "The code runner timed out." : "Could not reach the code runner.", aborted ? 504 : 502, aborted ? "TIMEOUT" : "NETWORK");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let msg = `Code runner error (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) msg = body.error;
      } catch {
        /* ignore */
      }
      const code = res.status === 429 ? "RATE_LIMITED" : res.status === 401 || res.status === 403 ? "AUTH" : "PROVIDER_ERROR";
      throw new CodeRunnerError(msg, res.status, code);
    }

    const data = (await res.json()) as OnlineCompilerResponse;
    return {
      stdout: data.output ?? "",
      stderr: data.error ?? "",
      exitCode: data.exit_code ?? null,
      signal: data.signal ?? null,
      status: data.status === "success" ? "success" : "error",
      timeSec: num(data.time),
      totalSec: num(data.total),
      memoryKb: num(data.memory),
      truncated: !!data.truncated,
      runtime: compiler,
    };
  }
}
