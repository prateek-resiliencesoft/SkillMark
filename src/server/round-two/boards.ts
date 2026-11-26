import "server-only";
import { CODING_QUESTION_RULE } from "@/lib/ai/prompts/generator";
import { getLanguage, normalizeLanguage } from "@/lib/code-languages";
import { createLogger } from "@/lib/logger";
import { listRoomIdentities, sendToIdentities } from "@/lib/livekit";
import {
  EMPTY_BOARD_STATE,
  TASK_STATUSES,
  boardTaskKey,
  checkPreview,
  codeContextPrompt,
  codeFromSnapshot,
  giveTaskState,
  normalizeBoardState,
  normalizeRunOutput,
  normalizeTask,
  snippetsFromSnapshots,
  statusAfterSave,
  taskLocked,
  taskFromBankItem,
  taskFromGenerated,
  type BoardKind,
  type BoardReplay,
  type BoardSnapshotRow,
  type BoardState,
  type CodingTask,
  type TaskAnswer,
  type TaskStatus,
  type TaskSummary,
  type RoundTwoCodeSnippet,
} from "@/lib/round-two/boards";
import { AGENT_IDENTITY_PREFIX, DATA_TOPICS, candidateIdentity, type Round1Context } from "@/lib/round-two/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callJson, clip } from "./ai";
import { round1ContextPrompt } from "./context";

const log = createLogger("round-two/boards");

const snapshotTaskId = boardTaskKey;

export type { BoardReplay };

const SUMMARY_COLUMNS = '"taskId", kind, task, status, "sentAt", "submittedAt"';

function toSummary(r: Record<string, unknown>): TaskSummary | null {
  const task = normalizeTask(r.task);
  if (!task) return null;
  const status = (TASK_STATUSES as readonly string[]).includes(r.status as string) ? (r.status as TaskStatus) : "sent";
  return { id: task.id, kind: task.kind, title: task.title, status, sentAt: (r.sentAt as string) ?? null, submittedAt: (r.submittedAt as string) ?? null };
}

/** Every task given in this round, oldest first (history list; no answer data). */
export async function loadTaskHistory(roundTwoId: string): Promise<TaskSummary[]> {
  const { data } = await supabaseAdmin
    .from("round_two_board_snapshots")
    .select(SUMMARY_COLUMNS)
    .eq("roundTwoId", roundTwoId)
    .order("sentAt", { ascending: true })
    .limit(30);
  return ((data ?? []) as Record<string, unknown>[]).map(toSummary).filter((t): t is TaskSummary => !!t);
}

/** Open task + the latest snapshots for it + the history (late join / panel poll). */
export async function loadBoardReplay(roundTwoId: string, boardStateRaw: unknown): Promise<BoardReplay> {
  const state = normalizeBoardState(boardStateRaw);
  const keys = Array.from(new Set([snapshotTaskId("coding", state), snapshotTaskId("whiteboard", state)]));
  const [{ data }, history] = await Promise.all([
    supabaseAdmin.from("round_two_board_snapshots").select('"taskId", kind, data').eq("roundTwoId", roundTwoId).in("taskId", keys),
    loadTaskHistory(roundTwoId),
  ]);
  const rows = (data ?? []) as { taskId: string; kind: string; data: string }[];
  const pick = (kind: BoardKind) => rows.find((r) => r.kind === kind && r.taskId === snapshotTaskId(kind, state))?.data || null;
  return { state, coding: pick("coding"), whiteboard: pick("whiteboard"), history };
}

/** Tasks with their answers, for the panel's history and the round page. */
export async function listTasksWithAnswers(roundTwoId: string): Promise<TaskAnswer[]> {
  const { data } = await supabaseAdmin
    .from("round_two_board_snapshots")
    .select(`${SUMMARY_COLUMNS}, data, preview, "runOutput"`)
    .eq("roundTwoId", roundTwoId)
    .order("sentAt", { ascending: true })
    .limit(20);
  const out: TaskAnswer[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const sum = toSummary(r);
    const task = normalizeTask(r.task);
    if (!sum || !task) continue;
    const code = sum.kind === "coding" ? codeFromSnapshot(r.data as string) : null;
    out.push({
      ...sum,
      prompt: task.prompt,
      language: code?.language ?? task.language,
      code: code?.code.slice(0, 20_000) ?? null,
      preview: sum.kind === "whiteboard" ? ((r.preview as string | null) ?? null) : null,
      runOutput: normalizeRunOutput(r.runOutput),
    });
  }
  return out;
}

/**
 * Write the candidate's snapshot into the active task's row. `final` submits it (locks the task).
 * Returns the new board state, or an error when the task is locked / not the active one.
 */
export async function saveBoardSnapshot(
  roundTwoId: string,
  room: string | null,
  boardStateRaw: unknown,
  kind: BoardKind,
  data: string,
  opts: { taskId?: string; submit?: boolean; runOutput?: unknown; preview?: unknown; announce?: boolean } = {},
): Promise<{ ok: true; state: BoardState } | { ok: false; error: string; status: number }> {
  const state = normalizeBoardState(boardStateRaw);
  if (!state.task) return { ok: false, error: "No task is open right now", status: 409 };
  if (state.task.kind !== kind) return { ok: false, error: "That board isn't open", status: 409 };
  if (opts.taskId && opts.taskId !== state.task.id) return { ok: false, error: "That task was closed", status: 409 };
  if (taskLocked(state.status)) return { ok: false, error: "This task is already submitted", status: 409 };
  let language: string | null = null;
  if (kind === "coding") {
    try {
      language = String((JSON.parse(data) as { language?: unknown }).language ?? "") || null;
    } catch {
      language = null;
    }
  }
  const nextStatus = opts.announce === false ? state.status : statusAfterSave(state.status, !!opts.submit);
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("round_two_board_snapshots").upsert(
    {
      roundTwoId,
      taskId: snapshotTaskId(kind, state),
      kind,
      task: state.task,
      language,
      data,
      updatedAt: now,
      ...(nextStatus && nextStatus !== state.status ? { status: nextStatus } : {}),
      ...(opts.submit ? { submittedAt: now, runOutput: normalizeRunOutput(opts.runOutput), preview: checkPreview(opts.preview) } : {}),
    },
    { onConflict: "roundTwoId,taskId,kind" },
  );
  if (error) {
    log.warn("snapshot save failed", roundTwoId, error.message);
    return { ok: false, error: "Could not save", status: 500 };
  }
  const next: BoardState = { ...state, status: nextStatus };
  if (nextStatus !== state.status && room) await setBoardState(roundTwoId, room, next);
  return { ok: true, state: next };
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

/** Close the active task unless it was submitted (its row keeps whatever the candidate wrote). */
async function closeActiveTask(roundTwoId: string, boardStateRaw: unknown): Promise<void> {
  const prev = normalizeBoardState(boardStateRaw);
  if (!prev.task || prev.status === "submitted" || prev.status === "ended") return;
  await supabaseAdmin
    .from("round_two_board_snapshots")
    .update({ status: "ended", endedAt: new Date().toISOString() })
    .eq("roundTwoId", roundTwoId)
    .eq("taskId", prev.task.id)
    .neq("status", "submitted");
}

/** Give a task: it opens on the candidate's screen. Any task still open is ended first. */
export async function giveTask(roundTwoId: string, room: string, boardStateRaw: unknown, task: CodingTask): Promise<BoardState> {
  await closeActiveTask(roundTwoId, boardStateRaw);
  const { error } = await supabaseAdmin.from("round_two_board_snapshots").upsert(
    {
      roundTwoId,
      taskId: task.id,
      kind: task.kind,
      task,
      language: task.kind === "coding" ? task.language : null,
      data: "",
      status: "sent",
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "roundTwoId,taskId,kind" },
  );
  if (error) throw new Error(error.message);
  const next = giveTaskState(task);
  await setBoardState(roundTwoId, room, next);
  return next;
}

/** End the open task for everyone (the candidate's screen closes). */
export async function endTask(roundTwoId: string, room: string, boardStateRaw: unknown): Promise<BoardState> {
  await closeActiveTask(roundTwoId, boardStateRaw);
  await setBoardState(roundTwoId, room, { ...EMPTY_BOARD_STATE });
  return { ...EMPTY_BOARD_STATE };
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
    .select('"taskId", kind, task, data, language, status, "runOutput"')
    .eq("roundTwoId", roundTwoId)
    .eq("kind", "coding")
    .order("sentAt", { ascending: true });
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
