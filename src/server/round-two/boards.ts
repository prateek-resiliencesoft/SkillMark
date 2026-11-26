import "server-only";
import { CODING_QUESTION_RULE } from "@/lib/ai/prompts/generator";
import { getLanguage, normalizeLanguage } from "@/lib/code-languages";
import { createLogger } from "@/lib/logger";
import { listRoomIdentities, sendToIdentities } from "@/lib/livekit";
import {
  WHITEBOARD_TASK_ID,
  boardTaskKey,
  codeContextPrompt,
  normalizeBoardState,
  snippetsFromSnapshots,
  taskFromBankItem,
  taskFromGenerated,
  type BoardKind,
  type BoardReplay,
  type BoardSnapshotRow,
  type BoardState,
  type CodingTask,
  type RoundTwoCodeSnippet,
} from "@/lib/round-two/boards";
import { AGENT_IDENTITY_PREFIX, DATA_TOPICS, candidateIdentity, type Round1Context } from "@/lib/round-two/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callJson, clip } from "./ai";
import { round1ContextPrompt } from "./context";

const log = createLogger("round-two/boards");

const snapshotTaskId = boardTaskKey;

export type { BoardReplay };

/** Open boards + the latest snapshots for the active task (late join / panel poll). */
export async function loadBoardReplay(roundTwoId: string, boardStateRaw: unknown): Promise<BoardReplay> {
  const state = normalizeBoardState(boardStateRaw);
  const { data } = await supabaseAdmin
    .from("round_two_board_snapshots")
    .select('"taskId", kind, data')
    .eq("roundTwoId", roundTwoId)
    .in("taskId", [snapshotTaskId("coding", state), WHITEBOARD_TASK_ID]);
  const rows = (data ?? []) as { taskId: string; kind: string; data: string }[];
  return {
    state,
    coding: rows.find((r) => r.kind === "coding")?.data ?? null,
    whiteboard: rows.find((r) => r.kind === "whiteboard")?.data ?? null,
  };
}

/** Upsert the candidate's latest snapshot for the active task (data already size-checked). */
export async function saveBoardSnapshot(roundTwoId: string, boardStateRaw: unknown, kind: BoardKind, data: string): Promise<boolean> {
  const state = normalizeBoardState(boardStateRaw);
  let language: string | null = null;
  if (kind === "coding") {
    try {
      language = String((JSON.parse(data) as { language?: unknown }).language ?? "") || null;
    } catch {
      language = null;
    }
  }
  const { error } = await supabaseAdmin.from("round_two_board_snapshots").upsert(
    {
      roundTwoId,
      taskId: snapshotTaskId(kind, state),
      kind,
      task: kind === "coding" ? state.task : null,
      language,
      data,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "roundTwoId,taskId,kind" },
  );
  if (error) log.warn("snapshot save failed", roundTwoId, error.message);
  return !error;
}

/** Store what is open and tell everyone in the room (server packet, so clients can trust it). */
export async function setBoardState(roundTwoId: string, room: string, state: BoardState): Promise<void> {
  const { error } = await supabaseAdmin
    .from("round_two_interviews")
    .update({ boardState: state, updatedAt: new Date().toISOString() })
    .eq("id", roundTwoId);
  if (error) throw new Error(error.message);
  const people = (await listRoomIdentities(room)).filter((i) => !i.startsWith(AGENT_IDENTITY_PREFIX));
  await sendToIdentities(room, people, DATA_TOPICS.board, state);
}

export async function askCandidateToShare(roundTwoId: string, room: string, by: string): Promise<void> {
  await sendToIdentities(room, [candidateIdentity(roundTwoId)], DATA_TOPICS.shareRequest, { by });
}

/** Latest code for the copilot / live scoring ("" when no coding task ran). */
export async function latestCodeContext(roundTwoId: string): Promise<string> {
  const [{ data: round }, { data: snap }] = await Promise.all([
    supabaseAdmin.from("round_two_interviews").select('"boardState"').eq("id", roundTwoId).maybeSingle(),
    supabaseAdmin
      .from("round_two_board_snapshots")
      .select("task, data")
      .eq("roundTwoId", roundTwoId)
      .eq("kind", "coding")
      .order("updatedAt", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const state = normalizeBoardState(round?.boardState);
  if (!state.coding && !snap) return "";
  const task = state.task ?? normalizeBoardState({ task: snap?.task }).task;
  return codeContextPrompt(task, (snap?.data as string | undefined) ?? null);
}

/** Every coding task's final code, oldest first (report input). */
export async function loadCodeSnippets(roundTwoId: string): Promise<RoundTwoCodeSnippet[]> {
  const { data, error } = await supabaseAdmin
    .from("round_two_board_snapshots")
    .select('"taskId", kind, task, data, language')
    .eq("roundTwoId", roundTwoId)
    .eq("kind", "coding")
    .order("createdAt", { ascending: true });
  if (error) {
    log.warn("snapshot load failed", roundTwoId, error.message);
    return [];
  }
  return snippetsFromSnapshots((data ?? []) as BoardSnapshotRow[]);
}

/** Enabled CODING questions from the org's question bank. */
export async function listBankCodingTasks(organizationId: string): Promise<CodingTask[]> {
  const { data, error } = await supabaseAdmin
    .from("question_bank_items")
    .select('id, text, description, "starterCode"')
    .eq("organizationId", organizationId)
    .eq("type", "CODING")
    .eq("isEnabled", true)
    .order("order", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; text: string; description: string | null; starterCode: unknown }[])
    .map(taskFromBankItem)
    .filter((t): t is CodingTask => !!t);
}

const GENERATE_SYSTEM = `You write one live coding task for a human-led round 2 interview.
${CODING_QUESTION_RULE}
Pitch the difficulty at the candidate's level (from the round 1 context), solvable in about 15-25 minutes while talking it through.
Never use "Aural" or the product name.
Return VALID JSON ONLY: {"title": string (<= 8 words), "question": string (clear problem statement with 1-2 examples), "description": string (constraints / what a good answer covers), "starterCode": {"language": string, "code": string}}`;

/** AI coding task via the org's question-generation routing ("generate"). */
export async function generateCodingTask(opts: {
  organizationId: string;
  round1: Round1Context;
  hint: string;
  language: string;
}): Promise<{ task: CodingTask | null; tokens: number }> {
  const id = normalizeLanguage(opts.language);
  const label = getLanguage(id)?.label ?? id;
  const user = [
    round1ContextPrompt(opts.round1),
    `Language: ${label} (id "${id}") — the starter code must be in this language.`,
    opts.hint.trim() ? `The panel asks for: ${clip(opts.hint, 600)}` : "Pick a task that fits the role and the candidate's level.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data, tokens } = await callJson<Record<string, unknown>>({
    organizationId: opts.organizationId,
    task: "generate",
    maxTokens: 1500,
    temperature: 0.6,
    system: GENERATE_SYSTEM,
    messages: [{ role: "user", content: user }],
    signal: AbortSignal.timeout(45_000),
  });
  return { task: taskFromGenerated(data, id), tokens };
}
