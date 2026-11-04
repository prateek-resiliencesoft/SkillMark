"use client";

import {
  useCallback,
  useState,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useRef,
} from "react";
import {
  CODE_LANGUAGES,
  generateBoilerplate,
  getLanguage,
  normalizeLanguage,
} from "@/lib/code-languages";

export interface CodeEditorCanvasRef {
  /** Returns true if the editor has any non-empty code. */
  hasContent: () => boolean;
  /** Returns the current code string (or null if empty). */
  getSnapshotData: () => string | null;
  /** Loads previously saved code + language into the editor. */
  loadScene: (data: string) => void;
  /** Clears the editor. */
  resetScene: () => void;
  /** Returns the current language. */
  getLanguage: () => string;
}

interface CodeEditorCanvasProps {
  /** If true, the editor is read-only. */
  readOnly?: boolean;
  /**
   * JSON string of previously saved state to preload: { code, language, drafts?, starter? }.
   * A plain { code, language } (e.g. a question's starter code) is treated as the starter, and
   * other languages get a generated boilerplate with the same function signature.
   */
  initialData?: string;
  /** Called on every meaningful change (debounced). Use for auto-save. */
  onAutoSave?: (snapshotData: string) => void;
  /** Auto-save debounce interval in ms. Default 3000. */
  autoSaveInterval?: number;
  /** If true, fill the parent container instead of using a fixed height. */
  fillParent?: boolean;
  /** Called immediately on any change (before debounce). Use for dirty-state tracking. */
  onDirty?: () => void;
  /** If true, use dark theme for the editor. Default false. */
  dark?: boolean;
  /** Interview session id: lets candidates run code and logs runner errors to the session. */
  sessionId?: string;
  /** Show the Run button + console (default true when the language is executable). */
  runnable?: boolean;
  /** Called after each run (e.g. to give the AI interviewer context). */
  onRunResult?: (result: CodeRunOutput) => void;
}

export interface CodeRunOutput {
  language: string;
  languageLabel?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: number | null;
  status: "success" | "error";
  timeSec?: number | null;
  totalSec?: number | null;
  memoryKb?: number | null;
  truncated?: boolean;
  runtime?: string;
}

async function runCodeRequest(body: { language: string; code: string; stdin?: string; sessionId?: string }): Promise<CodeRunOutput> {
  const res = await fetch("/api/trpc/code.run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: body }),
  });
  const data = (await res.json().catch(() => null)) as
    | { result?: { data?: { json?: CodeRunOutput } }; error?: { json?: { message?: string } } }
    | null;
  if (!res.ok || !data?.result?.data?.json) {
    throw new Error(data?.error?.json?.message || `Run failed (${res.status})`);
  }
  return { ...data.result.data.json, language: body.language };
}

/** Kept for backwards compatibility with existing imports. */
const SUPPORTED_LANGUAGES = CODE_LANGUAGES.map((l) => ({ value: l.id, label: l.label }));
export { SUPPORTED_LANGUAGES };

type Starter = { language: string; code: string } | null;
interface EditorState {
  code: string;
  language: string;
  drafts: Record<string, string>;
  starter: Starter;
}

function parseState(data: string | undefined): EditorState | null {
  if (!data) return null;
  try {
    const raw = JSON.parse(data) as {
      code?: string;
      language?: string;
      drafts?: Record<string, string>;
      starter?: Starter;
    };
    const language = normalizeLanguage(raw.language);
    const code = raw.code ?? "";
    const drafts: Record<string, string> = { ...(raw.drafts ?? {}) };
    drafts[language] = code;
    // A bare { code, language } with no history is the question's starter code.
    const starter: Starter =
      raw.starter ?? (!raw.drafts && code ? { language, code } : null);
    return { code, language, drafts, starter };
  } catch {
    return null;
  }
}

export const CodeEditorCanvas = forwardRef<CodeEditorCanvasRef, CodeEditorCanvasProps>(
  function CodeEditorCanvas(
    {
      readOnly = false,
      initialData,
      onAutoSave,
      autoSaveInterval = 3000,
      fillParent = false,
      onDirty,
      dark = false,
      sessionId,
      runnable = true,
      onRunResult,
    },
    ref,
  ) {
    // Dynamically loaded Monaco Editor component
    const [Editor, setEditor] = useState<React.ComponentType<Record<string, unknown>> | null>(null);

    const codeRef = useRef("");
    const languageRef = useRef("javascript");
    /** Per-language drafts so switching back restores what the candidate typed. */
    const draftsRef = useRef<Record<string, string>>({});
    const starterRef = useRef<Starter>(null);
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onAutoSaveRef = useRef(onAutoSave);
    onAutoSaveRef.current = onAutoSave;
    const onDirtyRef = useRef(onDirty);
    onDirtyRef.current = onDirty;
    const lastSnapshot = useRef("");

    const applyState = (s: EditorState) => {
      codeRef.current = s.code;
      languageRef.current = s.language;
      draftsRef.current = s.drafts;
      starterRef.current = s.starter;
    };

    // ── Parse initial data (once) ─────────────────────────────────
    const initialised = useRef(false);
    if (!initialised.current) {
      initialised.current = true;
      const parsed = parseState(initialData);
      if (parsed) applyState(parsed);
    }

    const [language, setLanguage] = useState(languageRef.current);
    // Key to force re-mount Monaco when the document is swapped
    const [editorKey, setEditorKey] = useState(0);

    const serialize = () =>
      JSON.stringify({
        code: codeRef.current,
        language: languageRef.current,
        drafts: { ...draftsRef.current, [languageRef.current]: codeRef.current },
        starter: starterRef.current,
      });

    // ── Dynamic import (Monaco cannot be SSR'd) ───────────────────
    useEffect(() => {
      let cancelled = false;
      import("@monaco-editor/react").then((mod) => {
        if (cancelled) return;
        setEditor(() => mod.default as unknown as React.ComponentType<Record<string, unknown>>);
      });
      return () => { cancelled = true; };
    }, []);

    const scheduleSave = useCallback(() => {
      onDirtyRef.current?.();
      if (!onAutoSaveRef.current) return;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        if (!onAutoSaveRef.current || !codeRef.current.trim()) return;
        onAutoSaveRef.current(serialize());
      }, autoSaveInterval);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoSaveInterval]);

    // ── Handle code changes ───────────────────────────────────────
    const handleChange = useCallback((value: string | undefined) => {
      const code = value ?? "";
      codeRef.current = code;
      draftsRef.current[languageRef.current] = code;

      const snapshot = JSON.stringify({ code, language: languageRef.current });
      if (snapshot === lastSnapshot.current) return;
      lastSnapshot.current = snapshot;
      scheduleSave();
    }, [scheduleSave]);

    // ── Handle language changes: swap mode + per-language draft ───
    const handleLanguageChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
      const newLang = normalizeLanguage(e.target.value);
      const oldLang = languageRef.current;
      if (newLang === oldLang) return;

      draftsRef.current[oldLang] = codeRef.current;
      const next =
        draftsRef.current[newLang] ?? generateBoilerplate(newLang, starterRef.current);
      draftsRef.current[newLang] = next;

      codeRef.current = next;
      languageRef.current = newLang;
      setLanguage(newLang);
      setEditorKey((k) => k + 1);

      lastSnapshot.current = JSON.stringify({ code: next, language: newLang });
      scheduleSave();
    }, [scheduleSave]);

    // Cleanup timer on unmount
    useEffect(() => {
      return () => {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      };
    }, []);

    // ── Imperative ref for parent components ──────────────────────
    useImperativeHandle(
      ref,
      () => ({
        hasContent() {
          return codeRef.current.trim().length > 0;
        },

        getSnapshotData() {
          if (!codeRef.current.trim()) return null;
          return serialize();
        },

        loadScene(data: string) {
          const parsed = parseState(data);
          if (!parsed) return;
          applyState(parsed);
          setLanguage(parsed.language);
          setEditorKey((k) => k + 1);
        },

        resetScene() {
          applyState({ code: "", language: "javascript", drafts: {}, starter: null });
          setLanguage("javascript");
          setEditorKey((k) => k + 1);
        },

        getLanguage() {
          return languageRef.current;
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    // ── Run + console ────────────────────────────────────────────
    const [running, setRunning] = useState(false);
    const [runResult, setRunResult] = useState<CodeRunOutput | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [consoleOpen, setConsoleOpen] = useState(false);
    const [stdinOpen, setStdinOpen] = useState(false);
    const [stdin, setStdin] = useState("");
    const [consoleHeight, setConsoleHeight] = useState(180);
    const onRunResultRef = useRef(onRunResult);
    onRunResultRef.current = onRunResult;

    const runCode = useCallback(async () => {
      if (running) return;
      const code = codeRef.current;
      if (!code.trim()) {
        setConsoleOpen(true);
        setRunResult(null);
        setRunError("Write some code first.");
        return;
      }
      setRunning(true);
      setRunError(null);
      setConsoleOpen(true);
      try {
        const out = await runCodeRequest({
          language: languageRef.current,
          code,
          stdin: stdin || undefined,
          sessionId,
        });
        setRunResult(out);
        onRunResultRef.current?.(out);
      } catch (err) {
        setRunResult(null);
        setRunError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, [running, stdin, sessionId]);
    const runCodeRef = useRef(runCode);
    runCodeRef.current = runCode;

    const handleMount = useCallback((editor: unknown, monaco: unknown) => {
      const ed = editor as { addCommand: (k: number, fn: () => void) => void };
      const m = monaco as { KeyMod: { CtrlCmd: number }; KeyCode: { Enter: number } };
      ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => void runCodeRef.current());
    }, []);

    const startConsoleResize = (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = consoleHeight;
      const move = (ev: PointerEvent) => setConsoleHeight(Math.max(90, Math.min(520, startH + (startY - ev.clientY))));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    const meta = getLanguage(language);
    const canRun = runnable && !!meta?.runnerId;
    const options = CODE_LANGUAGES.some((l) => l.id === language)
      ? CODE_LANGUAGES
      : [...CODE_LANGUAGES, { id: language, label: language, version: "", badge: language.slice(0, 3).toUpperCase(), color: "#888888", tabSize: 2, insertSpaces: true, ext: "txt" }];

    // ── Render ────────────────────────────────────────────────────
    if (!Editor) {
      return (
        <div
          className={`flex items-center justify-center text-muted-foreground ${
            fillParent ? "h-full w-full" : "h-[400px] w-full rounded-lg border"
          }`}
        >
          Loading code editor...
        </div>
      );
    }

    return (
      <div
        className={
          fillParent
            ? "flex h-full w-full flex-col overflow-hidden"
            : "flex h-[400px] w-full flex-col rounded-lg border overflow-hidden"
        }
      >
        {/* Language selector toolbar */}
        <div
          className={
            dark
              ? "flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5"
              : "flex items-center gap-2 border-b bg-card px-3 py-1.5"
          }
        >
          <span
            aria-hidden
            className="inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded px-1 text-[10px] font-bold leading-none text-black/80"
            style={{ backgroundColor: meta?.color ?? "#888888" }}
          >
            {meta?.badge ?? language.slice(0, 3).toUpperCase()}
          </span>
          <select
            value={language}
            onChange={handleLanguageChange}
            disabled={readOnly}
            aria-label="Programming language"
            className={
              dark
                ? "rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 outline-none transition-colors focus:ring-1 focus:ring-zinc-500 hover:bg-zinc-700"
                : "rounded-md border bg-background px-2.5 py-1 text-xs font-medium shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring hover:bg-muted/50"
            }
          >
            {options.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.label}{lang.version ? ` (${lang.version})` : ""}
              </option>
            ))}
          </select>
          <span className={dark ? "ml-auto hidden text-[11px] text-zinc-500 md:inline" : "ml-auto hidden text-[11px] text-muted-foreground md:inline"}>
            Code is kept per language
          </span>
          {canRun && (
            <>
              <button
                type="button"
                onClick={() => { setStdinOpen((v) => !v); setConsoleOpen(true); }}
                className={
                  dark
                    ? "ml-auto rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 md:ml-2"
                    : "ml-auto rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted md:ml-2"
                }
              >
                {stdinOpen ? "Hide input" : "Input"}
              </button>
              <button
                type="button"
                onClick={() => void runCode()}
                disabled={running}
                title="Run (Ctrl/Cmd + Enter)"
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-60"
              >
                {running ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current" aria-hidden><path d="M4 2.5v11l9-5.5z" /></svg>
                )}
                {running ? "Running…" : "Run"}
              </button>
            </>
          )}
        </div>

        {/* Monaco Editor */}
        <div className="flex-1 min-h-0">
          <Editor
            key={editorKey}
            path={`solution-${editorKey}.${meta?.ext ?? "txt"}`}
            defaultLanguage={language}
            language={language}
            defaultValue={codeRef.current}
            onChange={handleChange}
            onMount={handleMount}
            theme={dark ? "vs-dark" : "vs-light"}
            options={{
              readOnly,
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on" as const,
              scrollBeyondLastLine: false,
              wordWrap: "on" as const,
              tabSize: meta?.tabSize ?? 2,
              insertSpaces: meta?.insertSpaces ?? true,
              detectIndentation: false,
              automaticLayout: true,
              padding: { top: 8 },
              scrollbar: {
                vertical: "auto" as const,
                horizontal: "auto" as const,
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
                useShadows: false,
              },
              overviewRulerLanes: 0,
            }}
          />
        </div>

        {/* Output console */}
        {canRun && consoleOpen && (
          <div
            className={dark ? "flex shrink-0 flex-col border-t border-zinc-800 bg-zinc-950 text-zinc-200" : "flex shrink-0 flex-col border-t bg-muted/30"}
            style={{ height: consoleHeight }}
          >
            <div
              onPointerDown={startConsoleResize}
              className={dark ? "h-1.5 cursor-row-resize bg-zinc-900 hover:bg-zinc-700" : "h-1.5 cursor-row-resize bg-muted hover:bg-primary/20"}
              aria-label="Resize console"
            />
            <div className={dark ? "flex items-center gap-2 border-b border-zinc-800 px-3 py-1 text-xs" : "flex items-center gap-2 border-b px-3 py-1 text-xs"}>
              <span className="font-semibold">Console</span>
              {runResult && (
                <>
                  <span className={runResult.status === "success" ? "rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-500" : "rounded bg-red-500/15 px-1.5 py-0.5 font-medium text-red-500"}>
                    {runResult.status === "success" ? "Success" : runResult.signal ? `Killed (signal ${runResult.signal})` : `Exit ${runResult.exitCode ?? "?"}`}
                  </span>
                  <span className="opacity-70">
                    {runResult.languageLabel ?? runResult.runtime}
                    {runResult.timeSec != null ? ` · ${runResult.timeSec.toFixed(3)}s` : ""}
                    {runResult.totalSec != null ? ` (total ${runResult.totalSec.toFixed(2)}s)` : ""}
                    {runResult.memoryKb != null ? ` · ${(runResult.memoryKb / 1024).toFixed(1)} MB` : ""}
                  </span>
                </>
              )}
              <button type="button" onClick={() => setConsoleOpen(false)} className="ml-auto opacity-60 hover:opacity-100" aria-label="Close console">✕</button>
            </div>
            <div className="flex min-h-0 flex-1">
              {stdinOpen && (
                <div className={dark ? "flex w-1/3 min-w-[140px] flex-col border-r border-zinc-800" : "flex w-1/3 min-w-[140px] flex-col border-r"}>
                  <span className="px-3 pt-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-60">Input (stdin)</span>
                  <textarea
                    value={stdin}
                    onChange={(e) => setStdin(e.target.value)}
                    spellCheck={false}
                    placeholder="Program input…"
                    className={dark ? "min-h-0 flex-1 resize-none bg-transparent px-3 py-1.5 font-mono text-xs outline-none placeholder:text-zinc-600" : "min-h-0 flex-1 resize-none bg-transparent px-3 py-1.5 font-mono text-xs outline-none"}
                  />
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed">
                {running && <div className="opacity-70">Running {meta?.label}…</div>}
                {!running && runError && <div className="whitespace-pre-wrap text-red-500">{runError}</div>}
                {!running && !runError && !runResult && (
                  <div className="opacity-60">Press Run (Ctrl/Cmd + Enter) to execute your code.</div>
                )}
                {!running && runResult && (
                  <>
                    {runResult.stdout && <pre className="whitespace-pre-wrap">{runResult.stdout}</pre>}
                    {runResult.stderr && (
                      <pre className="mt-1 whitespace-pre-wrap text-red-500">{runResult.stderr}</pre>
                    )}
                    {!runResult.stdout && !runResult.stderr && <div className="opacity-60">(no output)</div>}
                    {runResult.truncated && <div className="mt-1 text-amber-500">Output was truncated.</div>}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);
