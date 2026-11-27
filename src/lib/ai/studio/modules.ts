import type { AiTaskKind } from "@/lib/ai/credentials";

export type StudioModuleId =
  | "r1_voice"
  | "r1_chat"
  | "r1_report"
  | "r2_live"
  | "r2_scoring"
  | "r2_report"
  | "transcribe"
  | "resume"
  | "generate"
  | "adv_screening"
  | "adv_standard"
  | "adv_heavy";

export type StudioModule = {
  id: StudioModuleId;
  title: string;
  hint: string;
  task: AiTaskKind;
  /** Product modules vs Advanced depth rows. */
  group: "product" | "advanced";
  /** Canonical workload for ₹ estimates. */
  workload:
    | { kind: "text"; inputTokens: number; outputTokens: number }
    | { kind: "audio_min"; minutes: number };
};

/** Product-facing modules + Advanced depths (design choice C). */
export const STUDIO_MODULES: StudioModule[] = [
  {
    id: "r1_voice",
    title: "Round 1 · Voice",
    hint: "Live voice interview (Realtime / Gemini Live)",
    task: "voice",
    group: "product",
    workload: { kind: "audio_min", minutes: 15 },
  },
  {
    id: "r1_chat",
    title: "Round 1 · Chat / follow-ups",
    hint: "Text chat turns (depth still uses Advanced rows)",
    task: "interview",
    group: "product",
    workload: { kind: "text", inputTokens: 8_000, outputTokens: 1_500 },
  },
  {
    id: "r1_report",
    title: "Round 1 · Report",
    hint: "Post-interview scoring & summary",
    task: "report",
    group: "product",
    workload: { kind: "text", inputTokens: 12_000, outputTokens: 3_000 },
  },
  {
    id: "r2_live",
    title: "Round 2 · Live copilot",
    hint: "Claims, cross-checks, next-question suggestions",
    task: "round2_live",
    group: "product",
    workload: { kind: "text", inputTokens: 10_000, outputTokens: 2_000 },
  },
  {
    id: "r2_scoring",
    title: "Round 2 · Live scoring",
    hint: "Rubric score suggestions during the interview",
    task: "round2_scoring",
    group: "product",
    workload: { kind: "text", inputTokens: 6_000, outputTokens: 1_000 },
  },
  {
    id: "r2_report",
    title: "Round 2 · Final report",
    hint: "Report after the panel interview ends",
    task: "round2_report",
    group: "product",
    workload: { kind: "text", inputTokens: 15_000, outputTokens: 4_000 },
  },
  {
    id: "transcribe",
    title: "Transcribe / STT",
    hint: "Speech-to-text (Round 2 agent + related STT)",
    task: "round2_transcript",
    group: "product",
    workload: { kind: "audio_min", minutes: 15 },
  },
  {
    id: "resume",
    title: "Resume / CV parse",
    hint: "PDF extraction & profiling",
    task: "resume",
    group: "product",
    workload: { kind: "text", inputTokens: 20_000, outputTokens: 2_000 },
  },
  {
    id: "generate",
    title: "Question generation",
    hint: "AI interview builder · reject-reason draft",
    task: "generate",
    group: "product",
    workload: { kind: "text", inputTokens: 5_000, outputTokens: 2_500 },
  },
  {
    id: "adv_screening",
    title: "Advanced · Screening (light)",
    hint: "LIGHT follow-ups / simple screens",
    task: "screening",
    group: "advanced",
    workload: { kind: "text", inputTokens: 4_000, outputTokens: 800 },
  },
  {
    id: "adv_standard",
    title: "Advanced · Standard",
    hint: "MODERATE follow-ups",
    task: "standard",
    group: "advanced",
    workload: { kind: "text", inputTokens: 8_000, outputTokens: 1_500 },
  },
  {
    id: "adv_heavy",
    title: "Advanced · Heavy / multi-level",
    hint: "DEEP probes",
    task: "heavy",
    group: "advanced",
    workload: { kind: "text", inputTokens: 12_000, outputTokens: 2_500 },
  },
];

export function moduleById(id: StudioModuleId): StudioModule | undefined {
  return STUDIO_MODULES.find((m) => m.id === id);
}

export function moduleForTask(task: AiTaskKind): StudioModule | undefined {
  return STUDIO_MODULES.find((m) => m.task === task);
}
