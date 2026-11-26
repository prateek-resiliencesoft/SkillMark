"use client";

import { CodeEditorCanvas, type CodeEditorCanvasRef } from "@/components/code-editor/code-editor-canvas";
import { WhiteboardCanvas, type WhiteboardCanvasRef } from "@/components/whiteboard/whiteboard-canvas";
import { Button } from "@/components/ui/button";
import {
  DATA_TOPICS,
  type RoundTwoBoardKind,
  type RoundTwoBoardOpen,
  type RoundTwoBoardStateMsg,
} from "@/lib/round-two/types";
import { cn } from "@/lib/utils";
import { useDataChannel } from "@livekit/components-react";
import { Code2, PenLine, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const EMPTY: RoundTwoBoardOpen = { coding: false, whiteboard: false };
const enc = () => new TextEncoder();
const dec = () => new TextDecoder();

function parseOpen(raw: Uint8Array): RoundTwoBoardOpen | null {
  try {
    const o = JSON.parse(dec().decode(raw)) as Partial<RoundTwoBoardOpen>;
    return { coding: !!o.coding, whiteboard: !!o.whiteboard };
  } catch {
    return null;
  }
}

function parseState(raw: Uint8Array): RoundTwoBoardStateMsg | null {
  try {
    const o = JSON.parse(dec().decode(raw)) as Partial<RoundTwoBoardStateMsg>;
    if ((o.kind !== "coding" && o.kind !== "whiteboard") || typeof o.data !== "string") return null;
    return { kind: o.kind, data: o.data };
  } catch {
    return null;
  }
}

/** Shared coding + whiteboard open state over LiveKit data channel. */
export function useRoundTwoBoards() {
  const [open, setOpen] = useState<RoundTwoBoardOpen>(EMPTY);
  const [remoteCoding, setRemoteCoding] = useState<string | null>(null);
  const [remoteWhiteboard, setRemoteWhiteboard] = useState<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const suppressUntil = useRef(0);

  const { send: sendOpen } = useDataChannel(DATA_TOPICS.board, (msg) => {
    const next = parseOpen(msg.payload);
    if (!next) return;
    setOpen(next);
  });

  const { send: sendState } = useDataChannel(DATA_TOPICS.boardState, (msg) => {
    if (Date.now() < suppressUntil.current) return;
    const st = parseState(msg.payload);
    if (!st) return;
    if (st.kind === "coding") setRemoteCoding(st.data);
    else setRemoteWhiteboard(st.data);
  });

  const publishOpen = useCallback(
    async (next: RoundTwoBoardOpen) => {
      setOpen(next);
      try {
        await sendOpen(enc().encode(JSON.stringify(next)), { reliable: true, topic: DATA_TOPICS.board });
      } catch {
        /* peer may have left */
      }
    },
    [sendOpen],
  );

  const toggle = useCallback(
    (kind: RoundTwoBoardKind) => {
      const cur = openRef.current;
      void publishOpen({ ...cur, [kind]: !cur[kind] });
    },
    [publishOpen],
  );

  const publishSnapshot = useCallback(
    (kind: RoundTwoBoardKind, data: string) => {
      suppressUntil.current = Date.now() + 1200;
      void sendState(enc().encode(JSON.stringify({ kind, data } satisfies RoundTwoBoardStateMsg)), {
        reliable: true,
        topic: DATA_TOPICS.boardState,
      }).catch(() => {});
    },
    [sendState],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      const cur = openRef.current;
      if (cur.coding || cur.whiteboard) void publishOpen(cur);
    }, 1200);
    return () => clearTimeout(t);
  }, [publishOpen]);

  return { open, toggle, publishOpen, publishSnapshot, remoteCoding, remoteWhiteboard };
}

/** Interviewer controls to open coding / whiteboard for the candidate. */
export function BoardToolbar({
  open,
  onToggle,
  className,
}: {
  open: RoundTwoBoardOpen;
  onToggle: (kind: RoundTwoBoardKind) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        type="button"
        size="sm"
        variant={open.coding ? "default" : "secondary"}
        className="h-10"
        onClick={() => onToggle("coding")}
      >
        <Code2 className="mr-1.5 h-4 w-4" />
        {open.coding ? "Close coding" : "Open coding"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={open.whiteboard ? "default" : "secondary"}
        className="h-10"
        onClick={() => onToggle("whiteboard")}
      >
        <PenLine className="mr-1.5 h-4 w-4" />
        {open.whiteboard ? "Close whiteboard" : "Open whiteboard"}
      </Button>
    </div>
  );
}

function SyncedCodeBoard({
  remote,
  onSnapshot,
}: {
  remote: string | null;
  onSnapshot: (data: string) => void;
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
      runnable
      onAutoSave={onSnapshot}
      autoSaveInterval={1500}
    />
  );
}

function SyncedWhiteboard({
  remote,
  onSnapshot,
}: {
  remote: string | null;
  onSnapshot: (data: string) => void;
}) {
  const ref = useRef<WhiteboardCanvasRef>(null);
  const lastRemote = useRef<string | null>(null);
  useEffect(() => {
    if (!remote || remote === lastRemote.current) return;
    lastRemote.current = remote;
    ref.current?.loadScene(remote);
  }, [remote]);
  return (
    <WhiteboardCanvas
      ref={ref}
      fillParent
      onAutoSave={onSnapshot}
      autoSaveInterval={1500}
    />
  );
}

/** Renders open boards; peers sync via LiveKit (last-write-wins). */
export function BoardSurfaces({
  open,
  onClose,
  onSnapshot,
  remoteCoding,
  remoteWhiteboard,
  canClose,
  className,
}: {
  open: RoundTwoBoardOpen;
  onClose?: (kind: RoundTwoBoardKind) => void;
  onSnapshot: (kind: RoundTwoBoardKind, data: string) => void;
  remoteCoding: string | null;
  remoteWhiteboard: string | null;
  canClose?: boolean;
  className?: string;
}) {
  if (!open.coding && !open.whiteboard) return null;
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {open.coding && (
        <div className="flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5" /> Coding board
            </span>
            {canClose && onClose && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClose("coding")} aria-label="Close coding">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <SyncedCodeBoard remote={remoteCoding} onSnapshot={(data) => onSnapshot("coding", data)} />
          </div>
        </div>
      )}
      {open.whiteboard && (
        <div className="flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <PenLine className="h-3.5 w-3.5" /> Whiteboard
            </span>
            {canClose && onClose && (
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClose("whiteboard")} aria-label="Close whiteboard">
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <SyncedWhiteboard remote={remoteWhiteboard} onSnapshot={(data) => onSnapshot("whiteboard", data)} />
          </div>
        </div>
      )}
    </div>
  );
}
