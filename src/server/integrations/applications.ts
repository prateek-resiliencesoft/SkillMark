/* eslint-disable @typescript-eslint/no-explicit-any */
import { nanoid } from "@/lib/id";
import {
  CANDIDATE_KEYS,
  deriveApplicationStatus,
  isFileField,
  normaliseDetected,
  sniffFileType,
  validateSubmission,
  type FieldError,
  type FormField,
  type UploadedFileInfo,
} from "@/lib/forms/schema";
import { storage } from "@/lib/storage";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
export const FILES_BUCKET = "applications";

export interface IncomingFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface ParsedSubmission {
  candidate: { name?: string; email?: string; phone?: string };
  answers: Record<string, unknown>;
  files: Record<string, IncomingFile[]>;
}

export class SubmissionError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function appBaseUrl(request?: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (request) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    if (host && (!env || env.includes("localhost") || env.includes("127.0.0.1"))) {
      return `${proto}://${host}`;
    }
    const u = new URL(request.url);
    if (!env || env.includes("localhost") || env.includes("127.0.0.1")) {
      return `${u.protocol}//${u.host}`;
    }
  }
  if (env) return env;
  return "http://localhost:3000";
}

function setNested(target: ParsedSubmission, rawKey: string, value: unknown) {
  // candidate[name], answers[skills][], answers[skills], name/email at top level
  const m = rawKey.match(/^(candidate|answers)\[([^\]]+)\](\[\])?$/);
  if (m) {
    const [, group, key, arr] = m;
    if (group === "candidate") {
      (target.candidate as Record<string, unknown>)[key] = value;
    } else if (arr) {
      const prev = target.answers[key];
      target.answers[key] = Array.isArray(prev) ? [...prev, value] : [value];
    } else if (key in target.answers) {
      const prev = target.answers[key];
      target.answers[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      target.answers[key] = value;
    }
    return;
  }
  if (rawKey === "candidate" && typeof value === "string") {
    try { target.candidate = JSON.parse(value); } catch { /* ignore */ }
    return;
  }
  if (rawKey === "answers" && typeof value === "string") {
    try { Object.assign(target.answers, JSON.parse(value)); } catch { /* ignore */ }
  }
}

/** Parse JSON or multipart/form-data with a hard size limit. */
export async function parseSubmissionRequest(request: Request): Promise<ParsedSubmission> {
  const len = Number(request.headers.get("content-length") || "0");
  if (len > MAX_REQUEST_BYTES) {
    throw new SubmissionError("PAYLOAD_TOO_LARGE", "Request body exceeds 25 MB", 413);
  }
  const ct = request.headers.get("content-type") || "";
  const out: ParsedSubmission = { candidate: {}, answers: {}, files: {} };

  if (ct.includes("application/json")) {
    const text = await request.text();
    if (text.length > 1024 * 1024) throw new SubmissionError("PAYLOAD_TOO_LARGE", "JSON body exceeds 1 MB", 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      throw new SubmissionError("INVALID_JSON", "Request body is not valid JSON", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SubmissionError("INVALID_BODY", "Body must be a JSON object", 400);
    const b = body as Record<string, unknown>;
    if (b.candidate && typeof b.candidate === "object") out.candidate = b.candidate as ParsedSubmission["candidate"];
    if (b.answers && typeof b.answers === "object" && !Array.isArray(b.answers)) out.answers = b.answers as Record<string, unknown>;
    if (b.files) throw new SubmissionError("FILES_REQUIRE_MULTIPART", "File fields must be sent as multipart/form-data (files[<key>]=@file)", 400);
    return out;
  }

  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await request.formData(); } catch {
      throw new SubmissionError("INVALID_MULTIPART", "Could not parse multipart body", 400);
    }
    let total = 0;
    for (const [rawKey, value] of Array.from(form.entries())) {
      if (typeof value === "string") {
        setNested(out, rawKey, value);
        continue;
      }
      const fm = rawKey.match(/^files\[([^\]]+)\](\[\])?$/) || rawKey.match(/^files\.(.+)$/);
      const key = fm ? fm[1] : rawKey;
      const buf = new Uint8Array(await value.arrayBuffer());
      total += buf.length;
      if (total > MAX_REQUEST_BYTES) throw new SubmissionError("PAYLOAD_TOO_LARGE", "Uploaded files exceed 25 MB in total", 413);
      (out.files[key] ??= []).push({ name: (value as File).name || "upload", type: value.type || "application/octet-stream", bytes: buf });
    }
    return out;
  }

  throw new SubmissionError("UNSUPPORTED_MEDIA_TYPE", "Use Content-Type application/json or multipart/form-data", 415);
}

export interface FormRow {
  id: string;
  publicId: string;
  organizationId: string;
  projectId: string | null;
  userId: string;
  interviewId: string | null;
  name: string;
  description: string | null;
  status: string;
  fields: FormField[];
  config: Record<string, unknown>;
  settings: Record<string, unknown>;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getFormByPublicId(publicId: string): Promise<FormRow | null> {
  if (!/^frm_[a-z0-9]{8,40}$/.test(publicId)) return null;
  const { data } = await supabaseAdmin.from("interview_forms").select("*").eq("publicId", publicId).maybeSingle();
  return (data as FormRow) ?? null;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-100) || "file";
}

/**
 * Validate + persist an application: stores files, creates a candidate with an
 * invite link for the form's interview, inserts the application row.
 */
export async function createApplication(opts: {
  form: FormRow;
  input: ParsedSubmission;
  source: "api" | "hosted";
  apiKeyId?: string | null;
  environment?: "test" | "live";
  ip?: string | null;
  baseUrl: string;
}) {
  const { form, input } = opts;
  if (form.status !== "published") {
    throw new SubmissionError("FORM_NOT_PUBLISHED", "This form is not published", 409);
  }
  const fields = (form.fields ?? []) as FormField[];
  const answers: Record<string, unknown> = { ...input.answers };
  const keys = new Set(fields.map((f) => f.key));

  // Map candidate{} onto identity fields when the form has them.
  const cand = input.candidate ?? {};
  if (keys.has(CANDIDATE_KEYS.name) && answers[CANDIDATE_KEYS.name] == null && cand.name) answers[CANDIDATE_KEYS.name] = cand.name;
  if (keys.has(CANDIDATE_KEYS.email) && answers[CANDIDATE_KEYS.email] == null && cand.email) answers[CANDIDATE_KEYS.email] = cand.email;
  if (keys.has(CANDIDATE_KEYS.phone) && answers[CANDIDATE_KEYS.phone] == null && cand.phone) answers[CANDIDATE_KEYS.phone] = cand.phone;

  const fileInfos: Record<string, UploadedFileInfo[]> = {};
  for (const [k, list] of Object.entries(input.files)) {
    fileInfos[k] = list.map((f) => ({
      name: f.name,
      size: f.bytes.length,
      type: f.type,
      detected: normaliseDetected(sniffFileType(f.bytes.subarray(0, 600)), f.name),
    }));
  }

  const result = validateSubmission(fields, answers, fileInfos);
  const extra: FieldError[] = [];
  const name = String(cand.name ?? result.values[CANDIDATE_KEYS.name] ?? "").trim();
  const email = String(cand.email ?? result.values[CANDIDATE_KEYS.email] ?? "").trim();
  const phone = String(cand.phone ?? result.values[CANDIDATE_KEYS.phone] ?? "").trim();
  if (!name && !result.errors.some((e) => e.field === CANDIDATE_KEYS.name)) extra.push({ field: "candidate.name", code: "required", message: "candidate.name is required" });
  if (name.length > 200) extra.push({ field: "candidate.name", code: "too_long", message: "candidate.name is too long" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) extra.push({ field: "candidate.email", code: "invalid_email", message: "candidate.email must be a valid email" });
  const errors = [...result.errors, ...extra];
  if (errors.length) {
    throw new SubmissionError("VALIDATION_ERROR", "Submission failed validation", 422, errors);
  }

  if (!form.interviewId) {
    throw new SubmissionError("FORM_NOT_READY", "This form has no interview configured yet", 409);
  }

  const publicId = `app_${nanoid(20)}`;

  // Candidate first so object keys can use org/project/candidate layout.
  const inviteToken = nanoid(12);
  const { data: candidate, error: candErr } = await supabaseAdmin
    .from("candidates")
    .insert({
      interviewId: form.interviewId,
      name,
      email: email || null,
      phone: phone || null,
      inviteToken,
      notes: `Applied via ${opts.source === "api" ? "API" : "hosted form"} (${form.name})`,
    })
    .select("id")
    .single();
  if (candErr || !candidate) throw new SubmissionError("INTERNAL_ERROR", "Failed to create candidate", 500);

  const { data: interviewRow } = await supabaseAdmin
    .from("interviews")
    .select("projectId")
    .eq("id", form.interviewId)
    .maybeSingle();
  const projectId = interviewRow?.projectId || "unknown";

  // Store files: orgs/{org}/projects/{project}/candidates/{id}/cv|other/...
  const storedFiles: Record<string, { name: string; size: number; type: string; path: string }[]> = {};
  for (const [key, list] of Object.entries(input.files)) {
    const field = fields.find((f) => f.key === key);
    if (!field || !isFileField(field.type)) continue;
    const kind = field.type === "resume" || key === "resume" ? "cv" : "other";
    storedFiles[key] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const path = `orgs/${form.organizationId}/projects/${projectId}/candidates/${candidate.id}/${kind}/${i}-${safeName(f.name)}`;
      const { error } = await storage.from(FILES_BUCKET).upload(path, f.bytes, { contentType: f.type });
      if (error) throw new SubmissionError("STORAGE_ERROR", "Failed to store uploaded file", 500);
      storedFiles[key].push({ name: f.name, size: f.bytes.length, type: f.type, path });
    }
  }

  const { data: app, error: appErr } = await supabaseAdmin
    .from("applications")
    .insert({
      publicId,
      formId: form.id,
      organizationId: form.organizationId,
      interviewId: form.interviewId,
      candidateId: candidate.id,
      candidateName: name,
      candidateEmail: email || null,
      candidatePhone: phone || null,
      answers: result.values,
      files: storedFiles,
      status: "pending",
      source: opts.source,
      apiKeyId: opts.apiKeyId ?? null,
      environment: opts.environment ?? "live",
      submitterIp: opts.ip ?? null,
    })
    .select("*")
    .single();
  if (appErr || !app) throw new SubmissionError("INTERNAL_ERROR", "Failed to save application", 500);

  return serializeApplication(app, form, { inviteToken, sessionId: null }, null, opts.baseUrl, false);
}

export async function loadApplicationContext(app: Record<string, any>) {
  type Cand = { inviteToken: string | null; sessionId: string | null };
  let candidate: Cand | null = null as Cand | null;
  let session: Record<string, any> | null = null;
  if (app.candidateId) {
    const { data } = await supabaseAdmin.from("candidates").select("inviteToken, sessionId").eq("id", app.candidateId).maybeSingle();
    candidate = (data as Cand | null) ?? null;
  }
  if (candidate?.sessionId) {
    const { data } = await supabaseAdmin
      .from("sessions")
      .select("id, status, startedAt, completedAt, totalDurationSeconds, summary, insights, themes, sentiment, antiCheatingLog")
      .eq("id", candidate.sessionId)
      .maybeSingle();
    session = data ?? null;
  }
  return { candidate, session };
}

async function signFiles(files: Record<string, { name: string; size: number; type: string; path: string }[]>) {
  const out: Record<string, { name: string; size: number; type: string; url: string | null }[]> = {};
  for (const [k, list] of Object.entries(files ?? {})) {
    out[k] = [];
    for (const f of list) {
      const { data } = await storage.from(FILES_BUCKET).createSignedUrl(f.path, 3600);
      out[k].push({ name: f.name, size: f.size, type: f.type, url: data?.signedUrl ?? null });
    }
  }
  return out;
}

export async function serializeApplication(
  app: Record<string, any>,
  form: Pick<FormRow, "publicId" | "name">,
  candidate: { inviteToken: string | null; sessionId: string | null } | null,
  session: Record<string, any> | null,
  baseUrl: string,
  detailed: boolean,
) {
  const status = deriveApplicationStatus(app.status, session);
  const base: Record<string, unknown> = {
    id: app.publicId,
    form_id: form.publicId,
    form_name: form.name,
    status,
    source: app.source,
    environment: app.environment,
    candidate: { name: app.candidateName, email: app.candidateEmail, phone: app.candidatePhone },
    interview_url: candidate?.inviteToken ? `${baseUrl}/i/invite/${candidate.inviteToken}` : null,
    created_at: app.createdAt,
    updated_at: app.updatedAt,
  };
  if (!detailed) return base;
  base.answers = app.answers ?? {};
  base.files = await signFiles(app.files ?? {});
  base.interview = session
    ? {
        session_id: session.id,
        status: session.status,
        started_at: session.startedAt,
        completed_at: session.completedAt,
        duration_seconds: session.totalDurationSeconds,
      }
    : null;
  const log = Array.isArray(session?.antiCheatingLog) ? session!.antiCheatingLog : [];
  base.results =
    session && (session.status === "COMPLETED" || session.status === "DISQUALIFIED")
      ? {
          summary: session.summary ?? null,
          insights: session.insights ?? null,
          themes: session.themes ?? [],
          sentiment: session.sentiment ?? null,
          disqualified: session.status === "DISQUALIFIED",
          integrity_events: log.length,
        }
      : null;
  return base;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function submissionErrorResponse(err: unknown): Response {
  if (err instanceof SubmissionError) {
    return Response.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  console.error("[applications] unexpected error", err);
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } }, { status: 500 });
}

export function serializeFormSchema(form: FormRow, baseUrl: string) {
  const fields = (form.fields ?? []) as FormField[];
  return {
    id: form.publicId,
    name: form.name,
    description: form.description,
    status: form.status,
    hosted_url: `${baseUrl}/f/${form.publicId}`,
    endpoint: `${baseUrl}/api/v1/interview-forms/${form.publicId}/applications`,
    interview: { title: (form.config as { title?: string })?.title ?? null, linked: !!form.interviewId },
    fields: fields
      .filter((f) => !f.hidden)
      .map((f) => ({
        key: f.key,
        type: f.type,
        label: f.label,
        description: f.description ?? null,
        required: !!f.required,
        submit_as: isFileField(f.type) ? `files[${f.key}]` : `answers.${f.key}`,
        ...(f.options ? { options: f.options } : {}),
        ...(f.minLength != null ? { min_length: f.minLength } : {}),
        ...(f.maxLength != null ? { max_length: f.maxLength } : {}),
        ...(f.min != null ? { min: f.min } : {}),
        ...(f.max != null ? { max: f.max } : {}),
        ...(f.pattern ? { pattern: f.pattern } : {}),
        ...(isFileField(f.type) ? { allowed_file_types: f.allowedFileTypes ?? [], max_file_size_mb: f.maxFileSizeMb ?? 10, multiple: !!f.multiple } : {}),
      })),
    published_at: form.publishedAt,
    updated_at: form.updatedAt,
  };
}
