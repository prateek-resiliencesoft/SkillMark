/** Provider-agnostic code execution contract (OnlineCompiler.io today; Piston/Judge0 could implement it later). */
export interface CodeRunRequest {
  /** Our language id from src/lib/code-languages.ts */
  language: string;
  code: string;
  stdin?: string;
  /** Seconds of CPU/run time allowed (provider max applies). */
  timeLimitSec?: number;
}

export interface CodeRunResult {
  stdout: string;
  stderr: string;
  /** Compile errors, when the provider reports them separately (otherwise they appear in stderr). */
  compileOutput?: string;
  exitCode: number | null;
  signal: number | null;
  status: "success" | "error";
  /** Run time in seconds (excludes compile) and total incl. compile, when provided. */
  timeSec?: number | null;
  totalSec?: number | null;
  memoryKb?: number | null;
  truncated?: boolean;
  /** Provider runtime id that executed the code, e.g. "python-3.14". */
  runtime: string;
}

export class CodeRunnerError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
  ) {
    super(message);
    this.name = "CodeRunnerError";
  }
}

export interface CodeRunner {
  readonly name: string;
  isConfigured(): boolean;
  supports(language: string): boolean;
  run(req: CodeRunRequest): Promise<CodeRunResult>;
}
