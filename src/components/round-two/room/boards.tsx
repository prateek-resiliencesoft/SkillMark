"use client";

import { CodeEditorCanvas, type CodeEditorCanvasRef } from "@/components/code-editor/code-editor-canvas";
import { WhiteboardCanvas, type WhiteboardCanvasRef } from "@/components/whiteboard/whiteboard-canvas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { getLanguage } from "@/lib/code-languages";
import { KindIcon, TaskStatusBadge } from "./task-history";
import {
  BOARD_PANEL_POLL_MS,
  BOARD_SAVE_INTERVAL_MS,
  EMPTY_BOARD_STATE,
  boardTaskKey,
  isCandidatePacket,
  isServerPacket,
  livePacket,
  normalizeBoardState,
  parseLivePacket,
  taskInitialData,
  taskLocked,
  type BoardKind,
  type BoardReplay,
  type BoardState,
  type CodingTask,
  type TaskStatus,
  type TaskSummary,
} from "@/lib/round-two/boards";
import { DATA_TOPICS } from "@/lib/round-two/types";
import { cn } from "@/lib/utils";
import { useDataChannel } from "@livekit/components-react";
import { ChevronDown, ChevronUp, Code2, MonitorUp, PenLine, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const dec = () => new TextDecoder();

type Remote = { taskId: string; data: string } | null;

/**
 * Round 2 boards. Open / close + the task come only from the server (`r2.board`); the candidate
 * is the only writer and sends snapshots live to the panel (`r2.board.state`) and saves them
 * (throttled, plus a keepalive flush on leave); the panel follows read-only and re-reads the
 * saved board while one is open, in case a packet was missed or too large to send live.
 */
export function useRoundTwoBoards(opts: {
  side: "panel" | "candidate";
  /** False until the candidate is admitted (lobby can't receive data). */
  enabled?: boolean;
  loadReplay: () => Promise<BoardReplay | null>;
  /** Candidate only: save a snapshot (keepalive on leave). */
  persist?: (kind: BoardKind, taskId: string, data: string, keepalive: boolean) => Promise<unknown>;
}) {
  const { side, enabled = true } = opts;
  const [state, setState] = useState<BoardState>(EMPTY_BOARD_STATE);
  const [remoteCoding, setRemoteCoding] = useState<Remote>(null);
  const [remoteWhiteboard, setRemoteWhiteboard] = useState<Remote>(null);
  const [history, setHistory] = useState<TaskSummary[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadRef = useRef(opts.loadReplay);
  loadRef.current = opts.loadReplay;
  const persistRef = useRef(opts.persist);
  persistRef.current = opts.persist;
  /** Last live packet time per board; the panel's poll yields to a working live feed. */
  const lastLiveAt = useRef<Record<BoardKind, number>>({ coding: 0, whiteboard: 0 });
  /** Latest data per board: what the candidate still has to save / what the panel flushes on end. */
  const latest = useRef<Record<BoardKind, string | null>>({ coding: null, whiteboard: null });
  const dirty = useRef<Record<BoardKind, boolean>>({ coding: false, whiteboard: false });
  /** Which task `latest` belongs to (a copy from an earlier task is never flushed into the current one). */
  const latestTask = useRef<Record<BoardKind, string | null>>({ coding: null, whiteboard: null });

  const setRemote = useCallback((kind: BoardKind, r: Remote) => {
    if (kind === "coding") setRemoteCoding(r);
    else setRemoteWhiteboard(r);
    if (r) {
      latest.current[kind] = r.data;
      latestTask.current[kind] = r.taskId;
    }
  }, []);

  const applyReplay = useCallback(
    (r: BoardReplay | null, onlyStale: boolean) => {
      if (!r) return;
      const st = normalizeBoardState(r.state);
      setState(st);
      setHistory(r.history ?? []);
      for (const kind of ["coding", "whiteboard"] as const) {
        const data = r[kind];
        if (!data) continue;
        if (onlyStale && Date.now() - lastLiveAt.current[kind] < BOARD_PANEL_POLL_MS * 2.5) continue;
        setRemote(kind, { taskId: boardTaskKey(kind, st), data });
      }
    },
    [setRemote],
  );

  // Late join / reconnect: replay what is open and the latest saved work.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadRef.current().then((r) => {
      if (!cancelled) applyReplay(r, false);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, applyReplay]);

  // Server-only topic: a participant's packet is ignored.
  useDataChannel(DATA_TOPICS.board, (msg) => {
    if (!isServerPacket(msg.from)) return;
    try {
      setState(normalizeBoardState(JSON.parse(dec().decode(msg.payload))));
    } catch {
      /* ignore */
    }
  });

  const { send } = useDataChannel(DATA_TOPICS.boardState, (msg) => {
    if (side !== "panel" || !isCandidatePacket(msg.from)) return;
    const m = parseLivePacket(dec().decode(msg.payload));
    if (!m || m.taskId !== boardTaskKey(m.kind, stateRef.current)) return;
    lastLiveAt.current[m.kind] = Date.now();
    setRemote(m.kind, { taskId: m.taskId, data: m.data });
  });

  // Panel backup poll while a board is open.
  const anyOpen = state.coding || state.whiteboard;
  useEffect(() => {
    if (side !== "panel" || !enabled || !anyOpen) return;
    const t = setInterval(() => {
      void loadRef.current().then((r) => applyReplay(r, true)).catch(() => {});
    }, BOARD_PANEL_POLL_MS);
    return () => clearInterval(t);
  }, [side, enabled, anyOpen, applyReplay]);

  // Candidate: throttled save + keepalive flush on leave.
  const flush = useCallback((keepalive: boolean) => {
    for (const kind of ["coding", "whiteboard"] as const) {
      const data = latest.current[kind];
      if (!dirty.current[kind] || !data) continue;
      dirty.current[kind] = false;
      void persistRef.current?.(kind, boardTaskKey(kind, stateRef.current), data, keepalive)?.catch(() => {
        dirty.current[kind] = true;
      });
    }
  }, []);
  useEffect(() => {
    if (side !== "candidate" || !enabled) return;
    const t = setInterval(() => flush(false), BOARD_SAVE_INTERVAL_MS);
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", onHide);
      flush(true);
    };
  }, [side, enabled, flush]);

  /** Candidate's editor changed: send live to the panel, save on the next tick. */
  const publishSnapshot = useCallback(
    (kind: BoardKind, data: string) => {
      if (side !== "candidate") return;
      latest.current[kind] = data;
      latestTask.current[kind] = boardTaskKey(kind, stateRef.current);
      dirty.current[kind] = true;
      const packet = livePacket(kind, boardTaskKey(kind, stateRef.current), data);
      if (packet) {
        void send(new TextEncoder().encode(packet), { reliable: true, topic: DATA_TOPICS.boardState }).catch(() => {});
      }
    },
    [side, send],
  );

  /** Panel: the last copy it saw of the open task, saved by `end` before the report runs. */
  const latestForFlush = useCallback(() => {
    const cur = (kind: BoardKind) =>
      latestTask.current[kind] === boardTaskKey(kind, stateRef.current) && stateRef.current.task?.kind === kind ? latest.current[kind] : null;
    return { coding: cur("coding"), whiteboard: cur("whiteboard") };
  }, []);

  // Task given / started / submitted / ended: refresh the history list.
  const statusKey = `${state.task?.id ?? ""}:${state.status ?? ""}`;
  useEffect(() => {
    if (!enabled) return;
    void loadRef.current().then((r) => r && setHistory(r.history ?? [])).catch(() => {});
  }, [enabled, statusKey]);

  return { state, setState, history, remoteCoding, remoteWhiteboard, publishSnapshot, latestForFlush };
}

/** Panel: give a coding / drawing task, see its status, end it. Hidden for observers (the server enforces it too). */
export function TaskToolbar({
  state,
  onGive,
  onEnd,
  onAskShare,
  busy,
  className,
}: {
  state: BoardState;
  onGive: (kind: BoardKind) => void;
  onEnd: () => void;
  onAskShare?: () => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-2", className)}>
      {state.task && state.status && (
        <span className="inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
          <KindIcon kind={state.task.kind} className="shrink-0" />
          <span className="max-w-[180px] truncate font-medium">{state.task.title}</span>
          <TaskStatusBadge status={state.status} />
        </span>
      )}
      <Button type="button" size="sm" variant="secondary" className="h-10" disabled={busy} onClick={() => onGive("coding")}>
        <Code2 className="mr-1.5 h-4 w-4" />
        Give coding task
      </Button>
      <Button type="button" size="sm" variant="secondary" className="h-10" disabled={busy} onClick={() => onGive("whiteboard")}>
        <PenLine className="mr-1.5 h-4 w-4" />
        Give drawing task
      </Button>
      {state.task && (
        <Button type="button" size="sm" variant="outline" className="h-10" disabled={busy} onClick={onEnd}>
          <Square className="mr-1.5 h-4 w-4" />
          End task
        </Button>
      )}
      {onAskShare && (
        <Button type="button" size="sm" variant="secondary" className="h-10" onClick={onAskShare}>
          <MonitorUp className="mr-1.5 h-4 w-4" />
          Ask candidate to share
        </Button>
      )}
    </div>
  );
}

/** Lets the candidate page read the editor / drawing at the moment of Submit (autosave is debounced). */
export interface BoardControls {
  coding?: () => string | null;
  whiteboard?: () => Promise<{ data: string | null; preview: string | null }>;
  lastRun?: () => { stdout: string; stderr: string; language: string } | null;
}

function SyncedCodeBoard({
  initialData,
  remote,
  readOnly,
  onSnapshot,
  roundTwo,
  controls,
}: {
  initialData?: string;
  remote: string | null;
  readOnly: boolean;
  onSnapshot?: (data: string) => void;
  roundTwo?: { token: string };
  controls?: React.MutableRefObject<BoardControls>;
}) {
  const ref = useRef<CodeEditorCanvasRef>(null);
  const lastRemote = useRef<string | null>(null);
  const lastRun = useRef<{ stdout: string; stderr: string; language: string } | null>(null);
  useEffect(() => {
    if (!remote || remote === lastRemote.current) return;
    lastRemote.current = remote;
    ref.current?.loadScene(remote);
  }, [remote]);
  useEffect(() => {
    if (!controls) return;
    const c = controls.current;
    c.coding = () => ref.current?.getSnapshotData() ?? null;
    c.lastRun = () => lastRun.current;
    return () => {
      c.coding = undefined;
      c.lastRun = undefined;
    };
  }, [controls]);
  return (
    <CodeEditorCanvas
      ref={ref}
      fillParent
      readOnly={readOnly}
      runnable={!readOnly}
      initialData={initialData}
      roundTwo={roundTwo}
      onRunResult={(r) => {
        lastRun.current = { stdout: r.stdout ?? "", stderr: r.stderr ?? "", language: r.language };
      }}
      onAutoSave={readOnly ? undefined : onSnapshot}
      autoSaveInterval={1500}
    />
  );
}

function SyncedWhiteboard({
  initialData,
  remote,
  readOnly,
  onSnapshot,
  controls,
}: {
  initialData?: string;
  remote: string | null;
  readOnly: boolean;
  onSnapshot?: (data: string) => void;
  controls?: React.MutableRefObject<BoardControls>;
}) {
  const ref = useRef<WhiteboardCanvasRef>(null);
  const lastRemote = useRef<string | null>(null);
  useEffect(() => {
    if (!remote || remote === lastRemote.current) return;
    lastRemote.current = remote;
    ref.current?.loadScene(remote);
  }, [remote]);
  useEffect(() => {
    if (!controls) return;
    const c = controls.current;
    c.whiteboard = async () => ({ data: ref.current?.getSnapshotData() ?? null, preview: (await ref.current?.getImageDataUrl()) ?? null });
    return () => {
      c.whiteboard = undefined;
    };
  }, [controls]);
  return <WhiteboardCanvas ref={ref} fillParent readOnly={readOnly} initialData={initialData} onAutoSave={readOnly ? undefined : onSnapshot} autoSaveInterval={1500} />;
}

function TaskPrompt({ task }: { task: CodingTask }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="shrink-0 border-b bg-muted/40 px-3 py-2 text-sm">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left font-medium" onClick={() => setCollapsed((c) => !c)}>
        <span className="truncate">{task.title}</span>
        {collapsed ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronUp className="h-4 w-4 shrink-0" />}
      </button>
      {!collapsed && <div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{task.prompt}</div>}
    </div>
  );
}

/** Candidate's side card: the question, a short hint, and Submit (with a confirm step). */
export function CandidateTaskCard({
  task,
  status,
  submitting,
  onSubmit,
  className,
}: {
  task: CodingTask;
  status: TaskStatus | null;
  submitting: boolean;
  onSubmit: () => void;
  className?: string;
}) {
  const [confirm, setConfirm] = useState(false);
  const done = taskLocked(status);
  return (
    <div className={cn("flex min-h-0 flex-col rounded-lg border bg-card text-card-foreground", className)}>
      <div className="flex shrink-0 items-start gap-2 border-b px-3 py-2">
        <KindIcon kind={task.kind} className="mt-1 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug">{task.title}</div>
          <div className="text-xs text-muted-foreground">
            {task.kind === "coding" ? `Write your code in ${getLanguage(task.language)?.label ?? task.language}` : "Draw your answer on the whiteboard"}
          </div>
        </div>
        {taskLocked(status) && status && <TaskStatusBadge status={status} />}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2 text-sm">
        <p className="whitespace-pre-wrap">{task.prompt}</p>
        {task.kind === "coding" && task.starter && <p className="text-xs text-muted-foreground">Starter code is already in the editor.</p>}
        {!done && (
          <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
            {task.kind === "coding"
              ? "Tip: press Run (Ctrl/Cmd + Enter) to test your code. You can talk through your thinking with the interviewers. Press Submit when you're done."
              : "Tip: you can talk through your drawing with the interviewers. Press Submit when you're done."}
          </p>
        )}
      </div>
      <div className="shrink-0 border-t p-3">
        {done ? (
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            {status === "submitted" ? "Submitted ✓ The interviewers can see your answer." : "This task was closed by the interviewer."}
          </p>
        ) : (
          <Button type="button" className="h-11 w-full text-base" disabled={submitting} onClick={() => setConfirm(true)}>
            {submitting ? "Submitting…" : "Submit answer"}
          </Button>
        )}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit your answer?</AlertDialogTitle>
            <AlertDialogDescription>The interviewers will see it as your final answer and you won&apos;t be able to change it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                onSubmit();
              }}
            >
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Renders the open task's board. `writer` = the candidate (read-only once submitted);
 * the panel gets a read-only live view with the task above it.
 */
export function BoardSurfaces({
  state,
  writer,
  showTask = true,
  onClose,
  onSnapshot,
  remoteCoding,
  remoteWhiteboard,
  roundTwo,
  controls,
  className,
}: {
  state: BoardState;
  writer: boolean;
  /** Collapsible task header above the board (the candidate has the side card instead). */
  showTask?: boolean;
  onClose?: () => void;
  onSnapshot?: (kind: BoardKind, data: string) => void;
  remoteCoding: Remote;
  remoteWhiteboard: Remote;
  /** Candidate's run context (code.run auth). */
  roundTwo?: { token: string };
  controls?: React.MutableRefObject<BoardControls>;
  className?: string;
}) {
  if (!state.task || (!state.coding && !state.whiteboard)) return null;
  const task = state.task;
  const locked = taskLocked(state.status);
  const editable = writer && !locked;
  const taskKey = boardTaskKey(task.kind, state);
  const remote = (task.kind === "coding" ? remoteCoding : remoteWhiteboard);
  const data = remote?.taskId === taskKey ? remote.data : null;
  const coding = task.kind === "coding";
  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card", className)}>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5 text-xs font-semibold">
        <span className="inline-flex items-center gap-1.5">
          <KindIcon kind={task.kind} />
          {writer ? (coding ? "Your code" : "Your whiteboard") : coding ? "Candidate's code (live, read-only)" : "Candidate's whiteboard (live, read-only)"}
        </span>
        {onClose && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="End task">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {showTask && <TaskPrompt task={task} />}
      <div className="min-h-0 flex-1">
        {coding ? (
          <SyncedCodeBoard
            key={taskKey}
            initialData={data ?? taskInitialData(task)}
            remote={data}
            readOnly={!editable}
            roundTwo={roundTwo}
            controls={controls}
            onSnapshot={(d) => onSnapshot?.("coding", d)}
          />
        ) : (
          <SyncedWhiteboard
            key={taskKey}
            initialData={data ?? undefined}
            remote={data}
            readOnly={!editable}
            controls={controls}
            onSnapshot={(d) => onSnapshot?.("whiteboard", d)}
          />
        )}
      </div>
    </div>
  );
}
