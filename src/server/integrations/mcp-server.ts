/* eslint-disable @typescript-eslint/no-explicit-any */
import { keyHasScope, type ApiKeyScope } from "@/lib/api-keys";
import type { ApiKeyAuth } from "@/lib/api-key-auth";
import { logApiUsage } from "@/lib/api-key-auth";
import type { InterviewConfig } from "@/lib/forms/schema";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  appBaseUrl,
  createApplication,
  loadApplicationContext,
  serializeApplication,
  serializeFormSchema,
  SubmissionError,
  type FormRow,
  type IncomingFile,
} from "@/server/integrations/applications";
import { resolveFormForKey } from "@/server/integrations/form-access";
import { generateQuestions } from "@/server/integrations/form-interview";
import { assertSafeRemoteUrl } from "@/lib/network-security";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { data } as Record<string, unknown> };
}
function fail(code: string, message: string, details?: unknown): ToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }, null, 2) }] };
}

/** Fetch a remote file for submit_application (https only, no private networks, size-capped). */
async function fetchRemoteFile(url: string, filename?: string): Promise<IncomingFile> {
  let u: URL;
  try {
    u = await assertSafeRemoteUrl(url);
  } catch (err) {
    throw new SubmissionError("INVALID_FILE_URL", (err as Error).message, 400);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(u, { signal: ctrl.signal, redirect: "error" });
    if (!r.ok || !r.body) throw new SubmissionError("FILE_FETCH_FAILED", `Could not download ${url} (${r.status})`, 400);
    const len = Number(r.headers.get("content-length") || "0");
    if (len > MAX_FILE_BYTES) throw new SubmissionError("PAYLOAD_TOO_LARGE", "Remote file exceeds 20 MB", 413);
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_FILE_BYTES) throw new SubmissionError("PAYLOAD_TOO_LARGE", "Remote file exceeds 20 MB", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    const name = filename || decodeURIComponent(u.pathname.split("/").pop() || "file");
    return { name, type: r.headers.get("content-type") || "application/octet-stream", bytes };
  } catch (err) {
    if (err instanceof SubmissionError) throw err;
    throw new SubmissionError("FILE_FETCH_FAILED", `Could not download ${url}`, 400);
  } finally {
    clearTimeout(t);
  }
}

async function interviewInScope(id: string, auth: ApiKeyAuth) {
  const { data } = await supabaseAdmin.from("interviews").select("*").eq("id", id).maybeSingle();
  if (!data) return { error: fail("NOT_FOUND", "Interview not found") };
  if (!auth.projectIds.includes(data.projectId as string)) return { error: fail("FORBIDDEN", "This API key cannot access this interview") };
  return { interview: data };
}

const INSTRUCTIONS = `Skillmark AI interview platform. Typical flow: list_interview_forms → get_interview_form (read field keys, required fields, file rules) → submit_application (candidate + answers keyed by field key) → share the returned interview_url with the candidate → get_application later for status (pending, in_progress, completed, disqualified) and results. Interviews: list_interviews / get_interview / create_interview; results of a finished interview: list_sessions / get_session_results. All data is scoped to the organization of the API key.`;

/** Build an MCP server bound to one authenticated API key (stateless, per request). */
export function buildMcpServer(auth: ApiKeyAuth, request: Request): McpServer {
  const server = new McpServer({ name: "skillmark", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const base = appBaseUrl(request);

  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    scope: ApiKeyScope,
    shape: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean },
  ) => {
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: { title: name.replace(/_/g, " "), ...annotations } },
      (async (args: z.infer<z.ZodObject<S>>) => {
        let res: ToolResult;
        if (!keyHasScope(auth.scopes, scope)) res = fail("FORBIDDEN", `This API key lacks the "${scope}" permission.`);
        else {
          try { res = await run(args); } catch (err) {
            res = err instanceof SubmissionError ? fail(err.code, err.message, err.details) : fail("INTERNAL_ERROR", err instanceof Error ? err.message : "Unexpected error");
          }
        }
        logApiUsage(new Request(new URL(`/api/mcp/${name}`, request.url), { method: "MCP" }), res.isError ? 400 : 200, auth);
        return res;
      }) as never,
    );
  };

  tool("list_interview_forms", "List the organization's candidate application forms (interview forms). Use this first to find a form id (frm_…) before submitting candidates.", "forms:read", {
    status: z.enum(["draft", "published", "unpublished"]).optional().describe("Filter by status; only published forms accept applications."),
  }, async ({ status }) => {
    let q = supabaseAdmin.from("interview_forms").select("*").eq("organizationId", auth.organizationId).order("updatedAt", { ascending: false }).limit(100);
    if (status) q = q.eq("status", status);
    const { data } = await q;
    const rows = ((data ?? []) as FormRow[]).filter((f) => !f.projectId || auth.projectIds.includes(f.projectId));
    return ok(rows.map((f) => ({ id: f.publicId, name: f.name, status: f.status, interview_title: (f.config as { title?: string })?.title ?? null, hosted_url: `${base}/f/${f.publicId}`, field_count: f.fields.length })));
  }, { readOnlyHint: true });

  tool("get_interview_form", "Get the field schema of an interview form: each field's key, type, required flag, options and file rules. Use the keys as answers in submit_application.", "forms:read", {
    form_id: z.string().describe("Form id, e.g. frm_abc123"),
  }, async ({ form_id }) => {
    const form = await resolveFormForKey(form_id, auth);
    if (form instanceof Response) return fail(form.status === 404 ? "NOT_FOUND" : "FORBIDDEN", (await form.json()).error.message);
    return ok(serializeFormSchema(form, base));
  }, { readOnlyHint: true });

  tool("submit_application", "Submit a candidate to a published interview form. Validates every answer against the form schema (same rules as the REST API). Returns the application id and the candidate's interview_url. File fields are passed in `files` as an https URL or base64 content.", "applications:write", {
    form_id: z.string().describe("Published form id (frm_…)"),
    candidate: z.object({
      name: z.string().min(1).describe("Candidate full name"),
      email: z.string().optional().describe("Candidate email"),
      phone: z.string().optional().describe("Candidate phone"),
    }),
    answers: z.record(z.string(), z.any()).default({}).describe("Answers keyed by field key (see get_interview_form). Multi-select = array of option strings, consent/checkbox = true/false, number = number."),
    files: z.array(z.object({
      field_key: z.string().describe("File field key, e.g. resume"),
      filename: z.string().describe("File name with extension, e.g. cv.pdf"),
      url: z.string().optional().describe("Public https URL to download the file from"),
      content_base64: z.string().optional().describe("Base64-encoded file content (max ~20 MB)"),
    })).max(10).optional(),
  }, async ({ form_id, candidate, answers, files }) => {
    const form = await resolveFormForKey(form_id, auth);
    if (form instanceof Response) return fail(form.status === 404 ? "NOT_FOUND" : "FORBIDDEN", (await form.json()).error.message);
    const fileMap: Record<string, IncomingFile[]> = {};
    for (const f of files ?? []) {
      let file: IncomingFile;
      if (f.content_base64) {
        const bytes = Uint8Array.from(Buffer.from(f.content_base64, "base64"));
        if (bytes.length > MAX_FILE_BYTES) return fail("PAYLOAD_TOO_LARGE", "File exceeds 20 MB");
        file = { name: f.filename, type: "application/octet-stream", bytes };
      } else if (f.url) {
        file = await fetchRemoteFile(f.url, f.filename);
      } else return fail("VALIDATION_ERROR", `files[${f.field_key}] needs url or content_base64`);
      (fileMap[f.field_key] ??= []).push(file);
    }
    const app = await createApplication({ form, input: { candidate, answers: answers ?? {}, files: fileMap }, source: "api", apiKeyId: auth.apiKeyId, environment: auth.environment, baseUrl: base });
    return ok(app);
  }, { readOnlyHint: false, openWorldHint: true });

  tool("list_applications", "List candidate applications for a form, newest first, with current status and interview link.", "applications:read", {
    form_id: z.string().describe("Form id (frm_…)"),
    limit: z.number().int().min(1).max(200).default(50),
  }, async ({ form_id, limit }) => {
    const form = await resolveFormForKey(form_id, auth);
    if (form instanceof Response) return fail(form.status === 404 ? "NOT_FOUND" : "FORBIDDEN", (await form.json()).error.message);
    const { data } = await supabaseAdmin.from("applications").select("*, candidate:candidates(inviteToken, sessionId, session:sessions(id, status))").eq("formId", form.id).order("createdAt", { ascending: false }).limit(limit);
    return ok(await Promise.all((data ?? []).map((a: any) => serializeApplication(a, form, a.candidate ?? null, a.candidate?.session ?? null, base, false))));
  }, { readOnlyHint: true });

  tool("get_application", "Get one application: status (pending, in_progress, completed, disqualified, cancelled), interview link, answers, temporary file links and interview results once completed.", "applications:read", {
    application_id: z.string().describe("Application id (app_…)"),
  }, async ({ application_id }) => {
    const { data: app } = await supabaseAdmin.from("applications").select("*").eq("publicId", application_id).maybeSingle();
    if (!app) return fail("NOT_FOUND", "Application not found");
    if (app.organizationId !== auth.organizationId) return fail("FORBIDDEN", "This API key cannot access this application");
    const { data: form } = await supabaseAdmin.from("interview_forms").select("publicId, name, projectId").eq("id", app.formId).single();
    if (form?.projectId && !auth.projectIds.includes(form.projectId)) return fail("FORBIDDEN", "This API key cannot access this application");
    const { candidate, session } = await loadApplicationContext(app);
    return ok(await serializeApplication(app, form!, candidate, session, base, true));
  }, { readOnlyHint: true });

  tool("list_interviews", "List AI interviews (templates) in the organization's projects.", "interviews:read", {
    limit: z.number().int().min(1).max(100).default(20),
  }, async ({ limit }) => {
    if (!auth.projectIds.length) return ok([]);
    const { data } = await supabaseAdmin.from("interviews").select("id, title, description, language, timeLimitMinutes, voiceEnabled, antiCheatingEnabled, publicSlug, isActive, createdAt, updatedAt, questions(id), sessions(id)").in("projectId", auth.projectIds).order("updatedAt", { ascending: false }).limit(limit);
    return ok((data ?? []).map((i: any) => ({ ...i, questions: undefined, sessions: undefined, question_count: i.questions?.length ?? 0, session_count: i.sessions?.length ?? 0, public_url: i.publicSlug ? `${base}/i/${i.publicSlug}` : null })));
  }, { readOnlyHint: true });

  tool("get_interview", "Get an interview with its ordered questions.", "interviews:read", {
    interview_id: z.string().uuid(),
  }, async ({ interview_id }) => {
    const r = await interviewInScope(interview_id, auth);
    if (r.error) return r.error;
    const { data: qs } = await supabaseAdmin.from("questions").select("id, order, text, type, description").eq("interviewId", interview_id).order("order");
    return ok({ ...r.interview, questions: qs ?? [] });
  }, { readOnlyHint: true });

  tool("create_interview", "Create a new AI interview. Provide predefined questions and/or set generate_questions=true to have AI write questions from the role, job description and settings (takes ~10-30s).", "interviews:write", {
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    job_role: z.string().max(300).optional(),
    job_description: z.string().max(20000).optional(),
    experience_level: z.enum(["intern", "junior", "mid", "senior", "lead"]).optional(),
    interview_type: z.enum(["technical", "behavioral", "mixed", "screening"]).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    number_of_questions: z.number().int().min(1).max(30).optional(),
    duration_minutes: z.number().int().min(5).max(180).optional(),
    language: z.string().max(10).default("en"),
    mode: z.enum(["voice", "chat"]).default("voice"),
    questions: z.array(z.string().max(2000)).max(50).optional().describe("Predefined questions (always included)"),
    generate_questions: z.boolean().default(true),
    anti_cheating: z.boolean().default(false),
    head_movement_detection: z.boolean().default(false),
  }, async (a) => {
    if (!auth.projectIds.length) return fail("FORBIDDEN", "No accessible project for this API key");
    const cfg: InterviewConfig = { title: a.title, description: a.description, jobRole: a.job_role, jobDescription: a.job_description, experienceLevel: a.experience_level, interviewType: a.interview_type, difficulty: a.difficulty, numberOfQuestions: a.number_of_questions, durationMinutes: a.duration_minutes, language: a.language, mode: a.mode, predefinedQuestions: a.questions ?? [], questionSource: a.generate_questions ? "ai" : "predefined" };
    let qs: { text?: string; type?: string; description?: string; options?: unknown; starterCode?: unknown }[] = (a.questions ?? []).map((text) => ({ text, type: "OPEN_ENDED" }));
    let objective: string | null = null;
    if (a.generate_questions) {
      const g = await generateQuestions(cfg);
      qs = g.questions;
      objective = g.objective;
      if (a.number_of_questions) qs = qs.slice(0, Math.max(a.number_of_questions, (a.questions ?? []).length));
    }
    if (!qs.length) return fail("VALIDATION_ERROR", "Provide questions or set generate_questions=true");
    const { data: iv, error } = await supabaseAdmin.from("interviews").insert({
      title: a.title, description: a.description ?? null, userId: auth.userId, projectId: auth.projectIds[0], language: a.language,
      timeLimitMinutes: a.duration_minutes ?? null, voiceEnabled: a.mode === "voice", chatEnabled: true, mode: a.mode === "voice" ? "VOICE" : "CHAT",
      antiCheatingEnabled: a.anti_cheating, headMovementDetectionEnabled: a.anti_cheating && a.head_movement_detection,
      objective: [a.job_role ? `Role: ${a.job_role}` : "", a.job_description ? `Job description:\n${a.job_description}` : "", objective ?? ""].filter(Boolean).join("\n\n") || null,
    }).select("id, title").single();
    if (error || !iv) return fail("INTERNAL_ERROR", error?.message ?? "Failed to create interview");
    const types = new Set(["OPEN_ENDED", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "CODING", "WHITEBOARD", "RESEARCH"]);
    await supabaseAdmin.from("questions").insert(qs.map((q, i) => ({ interviewId: iv.id, order: i, text: String(q.text), description: q.description ?? null, type: types.has(String(q.type)) ? q.type : "OPEN_ENDED", options: q.options ?? null, starterCode: q.starterCode ?? null, isRequired: true })));
    return ok({ id: iv.id, title: iv.title, question_count: qs.length, edit_url: `${base}/interviews/${iv.id}/edit` });
  }, { readOnlyHint: false });

  tool("list_sessions", "List candidate sessions (interview attempts) for an interview, newest first.", "interviews:read", {
    interview_id: z.string().uuid(),
    status: z.enum(["IN_PROGRESS", "COMPLETED", "ABANDONED", "DISQUALIFIED"]).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }, async ({ interview_id, status, limit }) => {
    const r = await interviewInScope(interview_id, auth);
    if (r.error) return r.error;
    let q = supabaseAdmin.from("sessions").select("id, status, participantName, participantEmail, startedAt, completedAt, totalDurationSeconds").eq("interviewId", interview_id).order("startedAt", { ascending: false }).limit(limit);
    if (status) q = q.eq("status", status);
    const { data } = await q;
    return ok(data ?? []);
  }, { readOnlyHint: true });

  tool("get_session_results", "Get the results of one interview session: status, summary, insights, themes, sentiment, integrity (anti-cheating) events and optionally the transcript.", "interviews:read", {
    session_id: z.string().uuid(),
    include_transcript: z.boolean().default(false),
  }, async ({ session_id, include_transcript }) => {
    const { data: s } = await supabaseAdmin.from("sessions").select("id, interviewId, status, participantName, participantEmail, startedAt, completedAt, totalDurationSeconds, summary, insights, themes, sentiment, antiCheatingLog").eq("id", session_id).maybeSingle();
    if (!s) return fail("NOT_FOUND", "Session not found");
    const r = await interviewInScope(s.interviewId as string, auth);
    if (r.error) return r.error;
    const log = Array.isArray(s.antiCheatingLog) ? s.antiCheatingLog : [];
    const out: Record<string, unknown> = { ...s, antiCheatingLog: undefined, integrity_events: log.map((e: any) => ({ type: e.type, timestamp: e.timestamp, detail: e.detail })) };
    if (include_transcript) {
      const { data: m } = await supabaseAdmin.from("messages").select("role, content, timestamp").eq("sessionId", session_id).eq("contentType", "TEXT").order("timestamp").limit(500);
      out.transcript = m ?? [];
    }
    return ok(out);
  }, { readOnlyHint: true });

  return server;
}
