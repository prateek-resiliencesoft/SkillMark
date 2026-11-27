/**
 * Candidate-only mic track (no AI voice on it), recorded next to the mixed
 * interview recording. A cleaner source for the post-interview transcript:
 * nothing to separate from the interviewer.
 *
 * Uploaded in ~10 s parts as `mic_part` (see /api/session/upload). Strictly
 * best-effort: every failure is swallowed (one quiet log line), and none of
 * this can block, slow down or break the interview or the main recording.
 * A new run starts whenever the mic stream changes (runId = start time, ms),
 * because the parts of one run must be byte-continuous MediaRecorder slices.
 */
const PART_INTERVAL_MS = 10_000;
const SLICE_MS = 5_000;
const BITRATE = 32_000;
/** Parts kept per run for retry; beyond this the oldest are dropped so memory never grows without bound. */
const MAX_QUEUED_PARTS = 60;
const MAX_ATTEMPTS = 3;

type Part = { seq: number; blob: Blob; elapsedSec: number; attempts: number };

type Run = {
  runId: number;
  seq: number;
  unsent: Blob[];
  queue: Part[];
  recorder: MediaRecorder;
  mime: string;
};

export type MicTrackRecorder = {
  /** Start (or restart on a new stream) recording the mic. Never throws. */
  start(stream: MediaStream): void;
  /** Stop and upload what is left (bounded by timeoutMs). Never throws. */
  stop(timeoutMs?: number): Promise<void>;
  /** Push what is recorded so far (tab hidden / closing). Never throws. */
  flush(): void;
};

export function createMicTrackRecorder(sessionId: string): MicTrackRecorder {
  const runs: Run[] = [];
  let current: Run | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let uploading = false;
  let disabled = false;
  let warned = false;

  const warn = (msg: string, err?: unknown) => {
    if (warned) return;
    warned = true;
    console.warn(`[mic-track] ${msg}`, err instanceof Error ? err.message : (err ?? ""));
  };

  const cut = (run: Run) => {
    if (!run.unsent.length) return;
    const blob = new Blob(run.unsent, { type: run.mime || "audio/webm" });
    run.unsent = [];
    run.queue.push({
      seq: run.seq++,
      blob,
      elapsedSec: Math.max(0, (Date.now() - run.runId) / 1000),
      attempts: 0,
    });
    if (run.queue.length > MAX_QUEUED_PARTS) run.queue = run.queue.slice(run.queue.length - MAX_QUEUED_PARTS);
  };

  const post = async (run: Run, part: Part): Promise<boolean> => {
    const form = new FormData();
    form.append("file", part.blob, `mic-${part.seq}`);
    form.append("sessionId", sessionId);
    form.append("type", "mic_part");
    form.append("runId", String(run.runId));
    form.append("seq", String(part.seq));
    form.append("elapsedSec", String(Math.round(part.elapsedSec)));
    try {
      const res = await fetch("/api/session/upload", { method: "POST", body: form });
      // Interview ended / part too big / storage full: stop trying for the rest of this session.
      if (res.status === 403 || res.status === 413 || res.status === 507) disabled = true;
      return res.ok;
    } catch {
      return false;
    }
  };

  const pending = () => runs.some((r) => r.queue.length > 0);

  const upload = async () => {
    if (uploading || disabled) return;
    uploading = true;
    try {
      for (const run of runs) {
        while (run.queue.length && !disabled) {
          const part = run.queue[0];
          if (await post(run, part)) {
            run.queue.shift();
            continue;
          }
          part.attempts += 1;
          if (part.attempts >= MAX_ATTEMPTS) {
            // A missing slice only shortens the usable mic track; the mixed recording is the safety net.
            run.queue.shift();
            warn("a mic part could not be uploaded; skipping it");
          } else {
            await new Promise((r) => setTimeout(r, 1000 * 2 ** part.attempts));
          }
        }
      }
      // Finished runs with nothing left to send can go.
      for (let i = runs.length - 1; i >= 0; i--) {
        if (runs[i] !== current && !runs[i].queue.length && runs[i].recorder.state === "inactive") runs.splice(i, 1);
      }
    } finally {
      uploading = false;
    }
  };

  const stopRun = (run: Run): Promise<void> =>
    new Promise((resolve) => {
      const r = run.recorder;
      if (r.state === "inactive") {
        cut(run);
        return resolve();
      }
      const finish = () => {
        cut(run);
        resolve();
      };
      const guard = setTimeout(finish, 3_000);
      r.onstop = () => {
        clearTimeout(guard);
        finish();
      };
      try {
        r.stop();
      } catch {
        clearTimeout(guard);
        finish();
      }
    });

  const tick = () => {
    for (const run of runs) cut(run);
    void upload();
  };

  const start = (stream: MediaStream) => {
    if (disabled || typeof MediaRecorder === "undefined") return;
    try {
      const tracks = stream.getAudioTracks();
      if (!tracks.length) return;
      const previous = current;
      const mime =
        ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const micOnly = new MediaStream(tracks);
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(micOnly, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: BITRATE });
      } catch {
        recorder = new MediaRecorder(micOnly, mime ? { mimeType: mime } : undefined);
      }
      const run: Run = { runId: Date.now(), seq: 0, unsent: [], queue: [], recorder, mime };
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) run.unsent.push(e.data);
      };
      recorder.onerror = () => warn("mic recorder error");
      recorder.start(SLICE_MS);
      runs.push(run);
      current = run;
      // A new mic: close the old run (its last slice still uploads under its own run id).
      if (previous) void stopRun(previous).then(() => void upload());
      if (!timer) timer = setInterval(tick, PART_INTERVAL_MS);
    } catch (err) {
      warn("could not start the mic track", err);
    }
  };

  const flush = () => {
    try {
      if (current && current.recorder.state !== "inactive") current.recorder.requestData();
      setTimeout(tick, 50);
    } catch {
      /* best effort */
    }
  };

  const stop = async (timeoutMs = 8_000) => {
    try {
      if (timer) clearInterval(timer);
      timer = null;
      await Promise.all(runs.map(stopRun));
      current = null;
      const deadline = Date.now() + timeoutMs;
      while ((pending() || uploading) && !disabled && Date.now() < deadline) {
        if (!uploading) void upload();
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      warn("could not finish the mic track", err);
    }
  };

  return { start, stop, flush };
}
