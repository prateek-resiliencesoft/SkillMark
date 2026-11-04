import "server-only";
import { OnlineCompilerRunner } from "./onlinecompiler";
import type { CodeRunner } from "./types";

export * from "./types";

let instance: CodeRunner | null = null;

/** Returns the configured code runner. Swap the implementation here (e.g. a PistonRunner) to change providers. */
export function getCodeRunner(): CodeRunner {
  if (!instance) instance = new OnlineCompilerRunner();
  return instance;
}
