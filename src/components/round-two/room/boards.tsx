"use client";

import { CodeEditorCanvas, type CodeEditorCanvasRef } from "@/components/code-editor/code-editor-canvas";
import { WhiteboardCanvas, type WhiteboardCanvasRef } from "@/components/whiteboard/whiteboard-canvas";
import { Button } from "@/components/ui/button";
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
  type BoardKind,
  type BoardReplay,
  type BoardState,
  type CodingTask,
} from "@/lib/round-two/boards";
import { DATA_TOPICS } from "@/lib/round-two/types";
import { cn } from "@/lib/utils";
import { useDataChannel } from "@livekit/components-react";
import { ChevronDown, ChevronUp, Code2, MonitorUp, PenLine, X } from "lucide-react";
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
  persist?: (kind: BoardKind, data: string, keepalive: boolean) => Promise<unknown>;
}) {
  const { side, enabled = true } = opts;
  const [state, setState] = useState<BoardState>(EMPTY_BOARD_STATE);
  const [remoteCoding, setRemoteCoding] = useState<Remote>(null);
  const [remoteWhiteboard, setRemoteWhiteboard] = useState<Remote>(null);
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

  const setRemote = useCallback((kind: BoardKind, r: Remote) => {
    if (kind === "coding") setRemoteCoding(r);
    else setRemoteWhiteboard(r);
    if (r) latest.current[kind] = r.data;
  }, []);

  const applyReplay = useCallback(
    (r: BoardReplay | null, onlyStale: boolean) => {
      if (!r) return;
      const st = normalizeBoardState(r.state);
      setState(st);
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
      void persistRef.current?.(kind, data, keepalive)?.catch(() => {
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
      dirty.current[kind] = true;
      const packet = livePacket(kind, boardTaskKey(kind, stateRef.current), data);
      if (packet) {
        void send(new TextEncoder().encode(packet), { reliable: true, topic: DATA_TOPICS.boardState }).catch(() => {});
      }
    },
    [side, send],
  );

  /** Panel: the last copy it saw, saved by `end` before the report runs. */
  const latestForFlush = useCallback(() => ({ coding: latest.current.coding, whiteboard: latest.current.whiteboard }), []);

  // A new task starts from its starter; forget the previous task's code.
  const taskKey = boardTaskKey("coding", state);
  const prevTaskKey = useRef(taskKey);
  useEffect(() => {
    if (prevTaskKey.current === taskKey) return;
    prevTaskKey.current = taskKey;
    latest.current.coding = null;
    dirty.current.coding = false;
  }, [taskKey]);

  return { state, setState, remoteCoding, remoteWhiteboard, publishSnapshot, latestForFlush };
}

/** Host / interviewer controls (hidden for observers; the server enforces it too). */
export function BoardToolbar({
  state,
  onCoding,
  onChangeTask,
  onToggleWhiteboard,
  onAskShare,
  busy,
  className,
}: {
  state: BoardState;
  onCoding: () => void;
  onChangeTask: () => void;
  onToggleWhiteboard: () => void;
  onAskShare?: () => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button type="button" size="sm" variant={state.coding ? "default" : "secondary"} className="h-10" disabled={busy} onClick={onCoding}>
        <Code2 className="mr-1.5 h-4 w-4" />
        {state.coding ? "Close coding" : "Open coding"}
      </Button>
      {state.coding && (
        <Button type="button" size="sm" variant="secondary" className="h-10" disabled={busy} onClick={onChangeTask}>
          {state.task ? "Change task" : "Set task"}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant={state.whiteboard ? "default" : "secondary"}
        className="h-10"
        disabled={busy}
        onClick={onToggleWhiteboard}
      >
        <PenLine className="mr-1.5 h-4 w-4" />
        {state.whiteboard ? "Close whiteboard" : "Open whiteboard"}
      </Button>
      {onAskShare && (
        <Button type="button" size="sm" variant="secondary" className="h-10" onClick={onAskShare}>
          <MonitorUp className="mr-1.5 h-4 w-4" />
          Ask candidate to share
        </Button>
      )}
    </div>
  );
}

function SyncedCodeBoard({
  initialData,
  remote,
  readOnly,
  onSnapshot,
  roundTwo,
}: {
  initialData?: string;
  remote: string | null;
  readOnly: boolean;
  onSnapshot?: (data: string) => void;
  roundTwo?: { token: string };
}) {
  const ref = useRef<CodeEditorCanvasRef>(null);
  const lastRemote = useRef<string | null>(null);
  useEffect(() => {
    if (!remote || remote === lastRemote.current) return;
    lastRemote.current = remote;
    ref.current?.loadScene(remote);
  }, [remote]);
  return (
    <CodeEditorCanvas
      ref={ref}
      fillParent
      readOnly={readOnly}
      runnable={!readOnly}
      initialData={initialData}
      roundTwo={roundTwo}
      onAutoSave={readOnly ? undefined : onSnapshot}
      autoSaveInterval={1500}
    />
  );
}

function SyncedWhiteboard({ remote, readOnly, onSnapshot }: { remote: string | null; readOnly: boolean; onSnapshot?: (data: string) => void }) {
  const ref = useRef<WhiteboardCanvasRef>(null);
  const lastRemote = useRef<string | null>(null);
  useEffect(() => {
    if (!remote || remote === lastRemote.current) return;
    lastRemote.current = remote;
    ref.current?.loadScene(remote);
  }, [remote]);
  return <WhiteboardCanvas ref={ref} fillParent readOnly={readOnly} onAutoSave={readOnly ? undefined : onSnapshot} autoSaveInterval={1500} />;
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

/** Renders the open boards. `writer` = the candidate; the panel gets a read-only live view. */
export function BoardSurfaces({
  state,
  writer,
  onClose,
  onSnapshot,
  remoteCoding,
  remoteWhiteboard,
  roundTwo,
  className,
}: {
  state: BoardState;
  writer: boolean;
  onClose?: (kind: BoardKind) => void;
  onSnapshot?: (kind: BoardKind, data: string) => void;
  remoteCoding: Remote;
  remoteWhiteboard: Remote;
  /** Candidate's run context (code.run auth). */
  roundTwo?: { token: string };
  className?: string;
}) {
  if (!state.coding && !state.whiteboard) return null;
  const taskKey = boardTaskKey("coding", state);
  const coding = remoteCoding?.taskId === taskKey ? remoteCoding.data : null;
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {state.coding && (
        <div className="flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5" /> {writer ? "Coding board" : "Candidate's code (live, read-only)"}
            </span>
            {onClose && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClose("coding")} aria-label="Close coding">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {state.task && <TaskPrompt task={state.task} />}
          <div className="min-h-0 flex-1">
            <SyncedCodeBoard
              key={taskKey}
              initialData={coding ?? taskInitialData(state.task)}
              remote={coding}
              readOnly={!writer}
              roundTwo={roundTwo}
              onSnapshot={(data) => onSnapshot?.("coding", data)}
            />
          </div>
        </div>
      )}
      {state.whiteboard && (
        <div className="flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <PenLine className="h-3.5 w-3.5" /> {writer ? "Whiteboard" : "Candidate's whiteboard (live, read-only)"}
            </span>
            {onClose && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClose("whiteboard")} aria-label="Close whiteboard">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <SyncedWhiteboard
              remote={remoteWhiteboard?.data ?? null}
              readOnly={!writer}
              onSnapshot={(data) => onSnapshot?.("whiteboard", data)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
