/** Client-safe shapes for the AI reasoning timeline. */

export type StepStatus = "running" | "done" | "error" | "skipped";

export interface ReasoningStep {
  /** Unique per run (node name + occurrence, e.g. "draft#2" on a retry loop). */
  id: string;
  node: string;
  label: string;
  status: StepStatus;
  /** Plain-language outcome of the step ("Found 9 claims in the CV"). */
  detail?: string;
  /** Model-emitted reasoning (`<think>` text or a model-written rationale). */
  thinking?: string;
  startedAt: number;
  ms?: number;
  tokens?: number;
  /** Prompt / input tokens when the provider reported usage. */
  promptTokens?: number;
  /** Completion / output tokens when the provider reported usage. */
  completionTokens?: number;
  models?: string[];
}

export type AiFlow =
  | "question-generation"
  | "question-refine"
  | "round2-plan"
  | "round2-copilot"
  | "round2-report"
  | "round1-summary";

export interface AiRunView {
  id: string;
  flow: AiFlow;
  status: "running" | "done" | "error";
  steps: ReasoningStep[];
  tokens: number;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  /** Langfuse deep link; only returned to org admins. */
  traceUrl: string | null;
}

export const FLOW_LABELS: Record<AiFlow, string> = {
  "question-generation": "Question set generation",
  "question-refine": "Question set refinement",
  "round2-plan": "Round 2 question plan",
  "round2-copilot": "Live copilot",
  "round2-report": "Round 2 report",
  "round1-summary": "Round 1 report",
};
