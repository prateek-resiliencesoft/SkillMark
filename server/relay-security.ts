/**
 * Shared admission control for the voice relays (voice-relay.ts,
 * openai-voice-relay.ts, gemini-voice-relay.ts).
 *
 * - Origin allowlist on the WebSocket upgrade (fails closed in production).
 * - Per-IP / global concurrent connection caps and a per-connection message
 *   rate limit; frames are size-checked and shape-validated before use.
 * - `init` must name an IN_PROGRESS, voice-enabled session the caller holds
 *   the session capability cookie for. The interview script (questions,
 *   objective, follow-up depth, integrity probing, candidate focus) is loaded
 *   from Postgres by that session id; the browser only supplies its position
 *   (start index, asked indexes) and language choice.
 */
import type { IncomingMessage } from "http";
import type { RawData, WebSocket } from "ws";
import { readCapabilityFromCookieHeader, sessionCapabilityOk } from "../src/lib/session-capability";
import { effectiveIntegrityConfig, type IntegrityConfigInput } from "../src/lib/integrity/config";
import { AI_WARNING_STRIKE, HEAD_STATE_LABEL, STRIKE_LABEL, aiStrikeNotice } from "../src/lib/head-movement";
import { normalizeCandidateLanguage } from "../src/lib/interview-language";
import type { CandidateFocus } from "../src/lib/ai/prompts/candidate-focus";
import type { RecentLine, ResumeHints } from "../src/lib/voice/resume-prompt";
import { buildVocabulary } from "../src/lib/transcript/stt-vocab";

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const WS_OPEN = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Largest legitimate frame is a whiteboard PNG data URL (≤1024px wide).
export const RELAY_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const PRE_INIT_MAX_BYTES = 256 * 1024;
export const MAX_AUDIO_HEX_CHARS = 128 * 1024;
export const MAX_TEXT_INPUT_CHARS = 4_000;
export const MAX_CODE_CHARS = 200_000;
export const MAX_WHITEBOARD_CHARS = RELAY_MAX_PAYLOAD_BYTES - 1024;
export const MAX_RESUME_LINES = 8;
export const MAX_RELAY_HISTORY = 200;

// ── Origin allowlist ────────────────────────────────────────────────

function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * VOICE_RELAY_ALLOWED_ORIGINS (comma list) or the origin of NEXT_PUBLIC_APP_URL.
 * `null` = allow any origin, only outside production when nothing is configured.
 * In production with nothing configured the list is empty: every upgrade is refused.
 */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env.VOICE_RELAY_ALLOWED_ORIGINS?.trim();
  if (raw) {
    return raw.split(",").map(normalizeOrigin).filter((o): o is string => !!o);
  }
  const app = env.NEXT_PUBLIC_APP_URL ? normalizeOrigin(env.NEXT_PUBLIC_APP_URL) : null;
  if (app) return [app];
  return env.NODE_ENV === "production" ? [] : null;
}

export function isOriginAllowed(origin: string | undefined, allowed: string[] | null): boolean {
  if (allowed === null) return true;
  if (!origin) return false;
  const o = normalizeOrigin(origin);
  return !!o && allowed.includes(o);
}

// ── Client IP + connection caps ─────────────────────────────────────

function isPrivatePeer(addr: string): boolean {
  const a = addr.replace(/^::ffff:/, "");
  return (
    a === "127.0.0.1" || a === "::1" ||
    /^10\./.test(a) || /^192\.168\./.test(a) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
    /^f[cd][0-9a-f]{2}:/i.test(a)
  );
}

/**
 * Peer address; X-Real-IP (overwritten by Caddy) only when the TCP peer is the
 * proxy on a private network — a direct client cannot pick its own bucket.
 */
export function relayClientIp(req: Pick<IncomingMessage, "headers" | "socket">): string {
  const peer = req.socket?.remoteAddress ?? "unknown";
  if (isPrivatePeer(peer)) {
    const h = req.headers["x-real-ip"];
    const real = (Array.isArray(h) ? h[0] : h)?.trim();
    if (real && real.length <= 64) return real;
  }
  return peer.replace(/^::ffff:/, "");
}

export class ConnectionLimiter {
  private readonly perIp = new Map<string, number>();
  private total = 0;

  constructor(private readonly maxPerIp: number, private readonly maxTotal: number) {}

  /** Release function, or null when a cap is reached. */
  tryAcquire(ip: string): (() => void) | null {
    const current = this.perIp.get(ip) ?? 0;
    if (this.total >= this.maxTotal || current >= this.maxPerIp) return null;
    this.perIp.set(ip, current + 1);
    this.total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const n = (this.perIp.get(ip) ?? 1) - 1;
      if (n <= 0) this.perIp.delete(ip);
      else this.perIp.set(ip, n);
    };
  }

  get size(): number {
    return this.total;
  }
}

/** Fixed-window message + byte budget for one socket. */
export class MessageRateLimiter {
  private windowStart: number;
  private messages = 0;
  private bytes = 0;

  constructor(
    private readonly maxMessages: number,
    private readonly maxBytes: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.windowStart = now();
  }

  allow(size: number): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.messages = 0;
      this.bytes = 0;
    }
    this.messages++;
    this.bytes += size;
    return this.messages <= this.maxMessages && this.bytes <= this.maxBytes;
  }
}

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface RelayGate {
  allowedOrigins: string[] | null;
  limiter: ConnectionLimiter;
  newRateLimiter: () => MessageRateLimiter;
  log: Logger;
}

export function createRelayGate(log: Logger, env: NodeJS.ProcessEnv = process.env): RelayGate {
  const allowedOrigins = resolveAllowedOrigins(env);
  if (allowedOrigins === null) log.warn("Voice relay accepts any Origin (set NEXT_PUBLIC_APP_URL or VOICE_RELAY_ALLOWED_ORIGINS)");
  else if (allowedOrigins.length === 0) log.error("Voice relay has no allowed Origin configured — refusing all connections");
  else log.info(`Voice relay allowed origins: ${allowedOrigins.join(", ")}`);
  return {
    allowedOrigins,
    limiter: new ConnectionLimiter(
      envInt(env, "VOICE_RELAY_MAX_CONNECTIONS_PER_IP", 8),
      envInt(env, "VOICE_RELAY_MAX_CONNECTIONS", 200),
    ),
    newRateLimiter: () => new MessageRateLimiter(
      envInt(env, "VOICE_RELAY_MAX_MESSAGES_PER_10S", 400),
      envInt(env, "VOICE_RELAY_MAX_BYTES_PER_10S", 16 * 1024 * 1024),
      10_000,
    ),
    log,
  };
}

/** `verifyClient` for WebSocketServer: Origin allowlist only. */
export function relayVerifyClient(gate: RelayGate) {
  return (info: { origin: string; req: IncomingMessage }, cb: (ok: boolean, code?: number, message?: string) => void) => {
    if (!isOriginAllowed(info.origin, gate.allowedOrigins)) {
      gate.log.warn(`Rejected WebSocket upgrade from origin ${JSON.stringify(info.origin ?? null)}`);
      cb(false, 403, "Forbidden");
      return;
    }
    cb(true);
  };
}

function rawSize(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0);
  return (data as Buffer | ArrayBuffer).byteLength;
}

/**
 * Connection caps, error listener and message rate limit for a new socket.
 * Returns false (socket already closed) when over a cap.
 */
export function admitRelayConnection(gate: RelayGate, ws: WebSocket, req: IncomingMessage): boolean {
  // An 'error' without a listener (oversized/invalid frame) would crash the shared process.
  ws.on("error", (err) => gate.log.warn(`Browser WS error: ${err.message}`));
  const ip = relayClientIp(req);
  const release = gate.limiter.tryAcquire(ip);
  if (!release) {
    gate.log.warn(`Rejected WebSocket from ${ip}: connection cap reached`);
    ws.close(1013, "Too many connections");
    return false;
  }
  ws.once("close", release);
  const rate = gate.newRateLimiter();
  ws.on("message", (data: RawData) => {
    if (!rate.allow(rawSize(data))) {
      gate.log.warn(`Closing WebSocket from ${ip}: message rate limit`);
      ws.terminate();
    }
  });
  return true;
}

// ── Frame parsing / validation ──────────────────────────────────────

export type ClientMessage = Record<string, unknown> & { type: string };

const KNOWN_TYPES = new Set([
  "init", "mic_test", "ping", "audio", "text_input", "text", "code_update", "whiteboard_update",
  "next_question", "prev_question", "set_language", "client_vad", "activity_start", "activity_end",
  "silence_prompt", "silence_check", "no_answer_skip", "answer_check_in",
]);

const ALLOWED_ANNOUNCEMENTS = new Set(
  [...Object.values(STRIKE_LABEL), ...Object.values(HEAD_STATE_LABEL), "Anti-cheating violation"]
    .map((reason) => aiStrikeNotice(AI_WARNING_STRIKE, reason))
    .filter((n): n is string => !!n),
);

/** `text` frames make the AI speak verbatim: only the fixed strike warnings qualify. */
export function isAllowedAnnouncement(text: unknown): text is string {
  return typeof text === "string" && ALLOWED_ANNOUNCEMENTS.has(text);
}

export function sanitizeCodeLanguage(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9+#._-]{1,32}$/.test(value) ? value : "plaintext";
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/**
 * JSON-parse and validate one browser frame. Returns null for anything that is
 * not a known message type with a well-formed, size-capped payload.
 */
export function parseClientMessage(data: RawData | string, maxBytes = RELAY_MAX_PAYLOAD_BYTES): ClientMessage | null {
  const text = typeof data === "string" ? data : rawToString(data);
  if (text.length > maxBytes) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.type !== "string" || !KNOWN_TYPES.has(m.type)) return null;
  switch (m.type) {
    case "audio":
      if (!isStr(m.data, MAX_AUDIO_HEX_CHARS) || m.data.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(m.data)) return null;
      break;
    case "text_input":
      if (!isStr(m.content, MAX_TEXT_INPUT_CHARS)) return null;
      break;
    case "text":
      if (!isAllowedAnnouncement(m.content)) return null;
      break;
    case "code_update":
      if (m.content !== undefined && !isStr(m.content, MAX_CODE_CHARS)) return null;
      m.language = sanitizeCodeLanguage(m.language);
      break;
    case "whiteboard_update":
      if (!isStr(m.imageDataUrl, MAX_WHITEBOARD_CHARS) || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]*$/.test(m.imageDataUrl)) return null;
      break;
    case "set_language":
      if (!isStr(m.language, 32)) return null;
      break;
    case "client_vad":
      if (m.reason !== undefined && !isStr(m.reason, 64)) m.reason = "unspecified";
      break;
    case "answer_check_in":
      m.transcript = isStr(m.transcript, 2_000) ? m.transcript.replace(/["[\]]/g, "") : "";
      break;
    case "init":
    case "mic_test":
      if (m.sessionId !== undefined && m.sessionId !== null && !isStr(m.sessionId, 64)) return null;
      break;
  }
  return m as ClientMessage;
}

/**
 * Wait for the first frame (`init` / `mic_test`). Anything else, an oversized
 * frame, or silence for `timeoutMs` closes the socket. Handlers run detached
 * with rejections caught so a bad init cannot crash the shared process.
 */
export function awaitRelayHandshake(
  ws: WebSocket,
  opts: {
    log: Logger;
    onInit: (msg: ClientMessage) => Promise<void> | void;
    onMicTest: (msg: ClientMessage) => Promise<void> | void;
    timeoutMs?: number;
  },
): void {
  const timeout = setTimeout(() => {
    opts.log.error("No init message received in time");
    ws.close(1008, "Init timeout");
  }, opts.timeoutMs ?? 10_000);
  const done = () => {
    clearTimeout(timeout);
    ws.removeListener("message", handler);
    ws.removeListener("close", onClose);
  };
  const onClose = () => clearTimeout(timeout);
  const run = (fn: () => Promise<void> | void) => {
    void Promise.resolve()
      .then(fn)
      .catch((err) => {
        opts.log.error("Relay handler failed:", err instanceof Error ? err.message : err);
        if (ws.readyState === WS_OPEN) ws.close(1011, "Relay error");
      });
  };
  const handler = (data: RawData, isBinary: boolean) => {
    const msg = isBinary ? null : parseClientMessage(data, PRE_INIT_MAX_BYTES);
    if (msg?.type === "ping") return;
    if (msg?.type === "mic_test") {
      done();
      run(() => opts.onMicTest(msg));
    } else if (msg?.type === "init" && msg.context && typeof msg.context === "object") {
      done();
      run(() => opts.onInit(msg));
    } else {
      done();
      ws.close(1008, "Expected init");
    }
  };
  ws.on("message", handler);
  ws.once("close", onClose);
}

// ── Session authorization + server-side interview context ───────────

export interface RelaySessionRecord {
  id: string;
  status: string;
  interviewId: string;
  participantName?: string | null;
  capabilityRequired?: boolean | null;
}

export interface RelayQuestionRecord {
  text?: string | null;
  type?: string | null;
  description?: string | null;
  options?: unknown;
  starterCode?: unknown;
  order?: number | null;
  skipIf?: unknown;
}

export interface RelayInterviewRecord extends IntegrityConfigInput {
  id: string;
  title?: string | null;
  objective?: string | null;
  aiName?: string | null;
  aiGender?: string | null;
  aiTone?: string | null;
  language?: string | null;
  followUpDepth?: string | null;
  voiceEnabled?: boolean | null;
  questions?: RelayQuestionRecord[] | null;
  project?: { organizationId?: string | null } | null;
}

export interface RelayCandidateRecord {
  name?: string | null;
  skills?: unknown;
  tailorInterview?: boolean | null;
  tailoredQuestions?: unknown;
}

export interface RelaySessionStore {
  getSession(sessionId: string): Promise<RelaySessionRecord | null>;
  getInterview(interviewId: string): Promise<RelayInterviewRecord | null>;
  getOrganizationStatus(organizationId: string): Promise<string | null>;
  getCandidate(sessionId: string): Promise<RelayCandidateRecord | null>;
  /** Organization display name (speech vocabulary only; optional). */
  getOrganizationName?(organizationId: string): Promise<string | null>;
  /** Last `limit` TEXT transcript lines, oldest first. */
  getRecentLines(sessionId: string, limit: number): Promise<RecentLine[]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from(table: string): any };

/** PostgREST-backed store; `getDb` defaults to the shared admin client. */
export function relaySessionStore(
  getDb: () => Promise<Db> = async () => (await import("../src/lib/supabase/admin")).supabaseAdmin,
): RelaySessionStore {
  return {
    async getSession(sessionId) {
      const { data } = await (await getDb())
        .from("sessions")
        .select("id, status, interviewId, capabilityRequired, participantName")
        .eq("id", sessionId)
        .maybeSingle();
      return (data as RelaySessionRecord | null) ?? null;
    },
    async getInterview(interviewId) {
      const { data } = await (await getDb())
        .from("interviews")
        .select("*, questions(*), project:projects(organizationId)")
        .eq("id", interviewId)
        .maybeSingle();
      return (data as RelayInterviewRecord | null) ?? null;
    },
    async getOrganizationStatus(organizationId) {
      const { data } = await (await getDb())
        .from("organizations")
        .select("status")
        .eq("id", organizationId)
        .maybeSingle();
      return (data as { status?: string } | null)?.status ?? null;
    },
    async getOrganizationName(organizationId) {
      const { data } = await (await getDb())
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();
      const name = (data as { name?: unknown } | null)?.name;
      return typeof name === "string" ? name : null;
    },
    async getCandidate(sessionId) {
      const { data } = await (await getDb())
        .from("candidates")
        .select("name, skills, tailorInterview, tailoredQuestions")
        .eq("sessionId", sessionId)
        .maybeSingle();
      return (data as RelayCandidateRecord | null) ?? null;
    },
    async getRecentLines(sessionId, limit) {
      const { data } = await (await getDb())
        .from("messages")
        .select("role, content, timestamp")
        .eq("sessionId", sessionId)
        .eq("contentType", "TEXT")
        .order("timestamp", { ascending: false })
        .limit(limit);
      const rows = (Array.isArray(data) ? data : []) as { role?: string; content?: unknown }[];
      return rows
        .filter((r) => (r.role === "USER" || r.role === "ASSISTANT") && typeof r.content === "string")
        .map((r) => ({ role: r.role === "USER" ? ("user" as const) : ("assistant" as const), text: String(r.content) }))
        .reverse();
    },
  };
}

export type RelayDenied = { ok: false; code: number; reason: string };

export type RelaySessionAuth =
  | { ok: true; sessionId: string; session: RelaySessionRecord; interview: RelayInterviewRecord; organizationId: string | null }
  | RelayDenied;

/**
 * The caller may run a voice interview on `sessionId`: the session exists, the
 * upgrade request carries its capability cookie (when required), it is
 * IN_PROGRESS, the interview has voice enabled, and the organization is ACTIVE.
 */
export async function authorizeRelaySession(
  store: RelaySessionStore,
  sessionId: unknown,
  cookieHeader: string | undefined,
): Promise<RelaySessionAuth> {
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
    return { ok: false, code: 4400, reason: "Invalid session" };
  }
  const session = await store.getSession(sessionId);
  if (!session) return { ok: false, code: 4404, reason: "Session not found" };
  if (!sessionCapabilityOk(session, readCapabilityFromCookieHeader(cookieHeader, sessionId))) {
    return { ok: false, code: 4401, reason: "Unauthorized" };
  }
  if (session.status !== "IN_PROGRESS") return { ok: false, code: 4409, reason: "Session not active" };
  const interview = await store.getInterview(session.interviewId);
  if (!interview) return { ok: false, code: 4404, reason: "Interview not found" };
  if (!interview.voiceEnabled) return { ok: false, code: 4403, reason: "Voice not enabled" };
  const organizationId = interview.project?.organizationId ?? null;
  if (organizationId) {
    const status = await store.getOrganizationStatus(organizationId);
    if (status && status !== "ACTIVE") return { ok: false, code: 4403, reason: "Organization not active" };
  }
  return { ok: true, sessionId: session.id, session, interview, organizationId };
}

export interface RelayInterviewContext {
  title: string;
  objective: string | null;
  aiName: string;
  aiGender?: string;
  aiTone: string;
  language: string;
  followUpDepth: string;
  integrityProbing: boolean;
  startQuestionIndex: number;
  resume: ResumeHints | null;
  candidateLanguage: string | null;
  candidateFocus: CandidateFocus | null;
  /** Names and terms speech recognition must spell right: candidate, company, skills, title. */
  vocabulary: string[];
  questions: Array<{
    text: string;
    type: string;
    description: string | null;
    options: { options: string[]; allowMultiple?: boolean } | null;
    starterCode: { language: string; code: string } | null;
    order: number;
    skipIf: { answerContainsAny?: string[]; reason?: string } | null;
  }>;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function focusQuestions(v: unknown): Array<{ text: string; skill?: string | null }> {
  if (!Array.isArray(v)) return [];
  return v.flatMap((q) => {
    const o = obj(q);
    if (!o || typeof o.text !== "string") return [];
    return [{ text: o.text, skill: typeof o.skill === "string" ? o.skill : null }];
  });
}

/**
 * Interview context for the relay prompt, from the database. From the browser
 * only the position (start index, asked indexes) and language choice are kept,
 * clamped/normalized; the resume recap comes from the stored transcript.
 */
export async function buildRelayInterviewContext(
  store: RelaySessionStore,
  auth: Extract<RelaySessionAuth, { ok: true }>,
  clientContext: unknown,
): Promise<RelayInterviewContext> {
  const iv = auth.interview;
  const questions = [...(iv.questions ?? [])]
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((q, i) => ({
      text: String(q.text ?? ""),
      type: String(q.type ?? "OPEN_ENDED"),
      description: typeof q.description === "string" ? q.description : null,
      options: (obj(q.options) as RelayInterviewContext["questions"][number]["options"]) ?? null,
      starterCode: (obj(q.starterCode) as RelayInterviewContext["questions"][number]["starterCode"]) ?? null,
      order: Number.isFinite(Number(q.order)) ? Number(q.order) : i,
      skipIf: (obj(q.skipIf) as RelayInterviewContext["questions"][number]["skipIf"]) ?? null,
    }));

  const client = obj(clientContext) ?? {};
  const last = Math.max(0, questions.length - 1);
  const rawStart = Number(client.startQuestionIndex);
  const startQuestionIndex = Number.isInteger(rawStart) ? Math.min(Math.max(0, rawStart), last) : 0;

  const clientResume = obj(client.resume);
  let resume: ResumeHints | null = null;
  if (clientResume || startQuestionIndex > 0) {
    const asked = Array.isArray(clientResume?.askedQuestionIndexes)
      ? [...new Set((clientResume!.askedQuestionIndexes as unknown[])
          .filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < questions.length))]
      : [];
    resume = { recent: await store.getRecentLines(auth.sessionId, MAX_RESUME_LINES), askedQuestionIndexes: asked };
  }

  const candidate = await store.getCandidate(auth.sessionId);
  const candidateFocus: CandidateFocus | null =
    candidate && candidate.tailorInterview !== false
      ? { skills: strArray(candidate.skills), questions: focusQuestions(candidate.tailoredQuestions) }
      : null;

  let organizationName: string | null = null;
  if (auth.organizationId && store.getOrganizationName) {
    organizationName = await store.getOrganizationName(auth.organizationId).catch(() => null);
  }
  const vocabulary = buildVocabulary({
    candidateName: (typeof candidate?.name === "string" && candidate.name.trim()) || auth.session.participantName || null,
    companyName: organizationName,
    interviewTitle: typeof iv.title === "string" ? iv.title : null,
    terms: strArray(candidate?.skills).slice(0, 15),
    texts: questions.map((q) => q.text),
    max: 60,
  });

  const candidateLanguage =
    typeof client.candidateLanguage === "string" && client.candidateLanguage.length <= 32
      ? normalizeCandidateLanguage(client.candidateLanguage)
      : null;

  return {
    title: String(iv.title ?? ""),
    objective: typeof iv.objective === "string" ? iv.objective : null,
    aiName: String(iv.aiName ?? "ResilienceSoft Interview"),
    aiGender: typeof iv.aiGender === "string" ? iv.aiGender : undefined,
    aiTone: String(iv.aiTone ?? "PROFESSIONAL"),
    language: String(iv.language ?? "en"),
    followUpDepth: String(iv.followUpDepth ?? "MODERATE"),
    integrityProbing: effectiveIntegrityConfig(iv).integrityChecksEnabled,
    startQuestionIndex,
    resume,
    candidateLanguage,
    candidateFocus,
    vocabulary,
    questions,
  };
}

export type RelayInitAuth =
  | { ok: true; sessionId: string; organizationId: string | null; context: RelayInterviewContext }
  | RelayDenied;

/** Authorize an `init` frame and build its interview context. */
export async function authorizeRelayInit(
  store: RelaySessionStore,
  msg: Record<string, unknown>,
  cookieHeader: string | undefined,
): Promise<RelayInitAuth> {
  const auth = await authorizeRelaySession(store, msg.sessionId, cookieHeader);
  if (!auth.ok) return auth;
  const context = await buildRelayInterviewContext(store, auth, msg.context);
  if (!context.questions.length) return { ok: false, code: 4404, reason: "Interview has no questions" };
  return { ok: true, sessionId: auth.sessionId, organizationId: auth.organizationId, context };
}

export function rejectRelayInit(ws: WebSocket, denied: RelayDenied, log: Logger): void {
  log.warn(`Rejected voice init: ${denied.reason}`);
  if (ws.readyState === WS_OPEN) ws.close(denied.code, denied.reason);
}

/** Append and drop the oldest entries beyond `max`. */
export function pushCapped<T>(arr: T[], item: T, max = MAX_RELAY_HISTORY): void {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}
