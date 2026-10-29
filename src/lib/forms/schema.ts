/**
 * Dynamic interview-form schema: field definitions, default template,
 * submission validation (shared by API, hosted form and builder preview),
 * application status mapping and integration-doc / cURL generation.
 * Pure TypeScript — safe on client and server.
 */

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "dropdown",
  "single_select",
  "multi_select",
  "date",
  "file",
  "resume",
  "cover_letter",
  "document",
  "checkbox",
  "consent",
  "url",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email",
  phone: "Phone number",
  number: "Number",
  dropdown: "Dropdown",
  single_select: "Single-select options",
  multi_select: "Multiple-select options",
  date: "Date",
  file: "File upload",
  resume: "Resume / CV upload",
  cover_letter: "Cover letter upload",
  document: "Custom document upload",
  checkbox: "Checkbox",
  consent: "Consent",
  url: "URL",
};

export const FILE_FIELD_TYPES: FieldType[] = ["file", "resume", "cover_letter", "document"];
export const OPTION_FIELD_TYPES: FieldType[] = ["dropdown", "single_select", "multi_select"];
export const isFileField = (t: FieldType) => FILE_FIELD_TYPES.includes(t);
export const isOptionField = (t: FieldType) => OPTION_FIELD_TYPES.includes(t);

/** Candidate identity is mapped from these field keys. */
export const CANDIDATE_KEYS = { name: "full_name", email: "email", phone: "phone" } as const;

export interface FormField {
  id: string;
  key: string;
  type: FieldType;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  hidden?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  patternMessage?: string;
  options?: string[];
  defaultValue?: string | number | boolean | string[];
  allowedFileTypes?: string[]; // extensions without dot, e.g. ["pdf","docx"]
  maxFileSizeMb?: number;
  multiple?: boolean; // multiple files
}

export interface InterviewConfig {
  title: string;
  description?: string;
  jobRole?: string;
  jobDescription?: string;
  experienceLevel?: "intern" | "junior" | "mid" | "senior" | "lead";
  interviewType?: "technical" | "behavioral" | "mixed" | "screening";
  difficulty?: "easy" | "medium" | "hard";
  numberOfQuestions?: number;
  categories?: string[];
  durationMinutes?: number;
  questionSource?: "ai" | "predefined";
  predefinedQuestions?: string[];
  evaluationCriteria?: { name: string; description?: string; weight?: number }[];
  instructions?: string;
  language?: string;
  mode?: "voice" | "chat";
  antiCheatingEnabled?: boolean;
  headMovementDetectionEnabled?: boolean;
}

export interface FormSettings {
  successMessage?: string;
  redirectToInterview?: boolean;
  allowedOrigins?: string[];
}

export const MAX_FILE_MB_LIMIT = 20;
export const DEFAULT_FILE_MB = 10;

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ()\-.]{6,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function slugKey(label: string): string {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return /^[a-z]/.test(k) ? k : `field_${k || "x"}`;
}

let _seq = 0;
export function newFieldId(): string {
  _seq += 1;
  return `f_${Date.now().toString(36)}${_seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function defaultFormFields(): FormField[] {
  const f = (p: Omit<FormField, "id">): FormField => ({ id: newFieldId(), ...p });
  return [
    f({ key: "full_name", type: "short_text", label: "Full Name", placeholder: "Jane Doe", required: true, minLength: 2, maxLength: 120 }),
    f({ key: "email", type: "email", label: "Email Address", placeholder: "jane@example.com", required: true }),
    f({ key: "phone", type: "phone", label: "Phone Number", placeholder: "+1 555 123 4567", required: true }),
    f({ key: "resume", type: "resume", label: "Resume / CV", description: "PDF or DOCX, max 10 MB", required: true, allowedFileTypes: ["pdf", "docx"], maxFileSizeMb: 10 }),
    f({ key: "cover_letter", type: "cover_letter", label: "Cover Letter", required: false, allowedFileTypes: ["pdf", "docx", "txt"], maxFileSizeMb: 5 }),
    f({ key: "years_of_experience", type: "number", label: "Years of Experience", required: true, min: 0, max: 60 }),
    f({ key: "skills", type: "multi_select", label: "Skills", required: false, options: ["JavaScript", "TypeScript", "Python", "React", "Node.js", "SQL"] }),
    f({ key: "portfolio_url", type: "url", label: "Portfolio URL", placeholder: "https://", required: false }),
    f({ key: "additional_documents", type: "document", label: "Additional Documents", required: false, allowedFileTypes: ["pdf", "docx", "png", "jpg"], maxFileSizeMb: 10, multiple: true }),
    f({ key: "consent", type: "consent", label: "I consent to the processing of my information for this application", required: true }),
  ];
}

export function defaultInterviewConfig(): InterviewConfig {
  return {
    title: "",
    description: "",
    jobRole: "",
    jobDescription: "",
    experienceLevel: "mid",
    interviewType: "technical",
    difficulty: "medium",
    numberOfQuestions: 6,
    categories: ["technical", "behavioral"],
    durationMinutes: 20,
    questionSource: "ai",
    predefinedQuestions: [],
    evaluationCriteria: [],
    instructions: "",
    language: "en",
    mode: "voice",
    antiCheatingEnabled: false,
    headMovementDetectionEnabled: false,
  };
}

/** Validate field definitions (builder save). Returns list of problems. */
export function validateFieldDefinitions(fields: FormField[]): string[] {
  const errs: string[] = [];
  const keys = new Set<string>();
  if (!Array.isArray(fields)) return ["fields must be an array"];
  if (fields.length > 60) errs.push("A form can have at most 60 fields");
  for (const f of fields) {
    const where = `Field "${f.label || f.key}"`;
    if (!FIELD_TYPES.includes(f.type)) errs.push(`${where}: unknown type ${f.type}`);
    if (!KEY_RE.test(f.key || "")) errs.push(`${where}: key must be lowercase letters, digits or _ and start with a letter`);
    if (keys.has(f.key)) errs.push(`${where}: duplicate key "${f.key}"`);
    keys.add(f.key);
    if (!f.label?.trim()) errs.push(`Field "${f.key}": label is required`);
    if (isOptionField(f.type) && (!f.options || f.options.filter((o) => o.trim()).length === 0))
      errs.push(`${where}: add at least one option`);
    if (f.minLength != null && f.maxLength != null && f.minLength > f.maxLength) errs.push(`${where}: min length > max length`);
    if (f.min != null && f.max != null && f.min > f.max) errs.push(`${where}: min > max`);
    if (isFileField(f.type) && f.maxFileSizeMb != null && (f.maxFileSizeMb <= 0 || f.maxFileSizeMb > MAX_FILE_MB_LIMIT))
      errs.push(`${where}: max file size must be 1-${MAX_FILE_MB_LIMIT} MB`);
    if (f.pattern) {
      try { new RegExp(f.pattern); } catch { errs.push(`${where}: invalid regex pattern`); }
    }
    if (f.required && f.hidden && f.defaultValue == null && !isFileField(f.type))
      errs.push(`${where}: a hidden required field needs a default value`);
  }
  return errs;
}

export interface UploadedFileInfo {
  name: string;
  size: number;
  type?: string;
  /** detected from magic bytes on server (pdf, docx, png, ...) or null */
  detected?: string | null;
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
  /** normalised answers (non-file fields), defaults applied */
  values: Record<string, unknown>;
}

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Validate a submission against the saved field schema.
 * `answers` holds non-file values (strings from multipart are coerced);
 * `files` maps field key -> uploaded file infos.
 */
export function validateSubmission(
  fields: FormField[],
  answers: Record<string, unknown>,
  files: Record<string, UploadedFileInfo[]> = {},
): ValidationResult {
  const errors: FieldError[] = [];
  const values: Record<string, unknown> = {};
  const known = new Set(fields.map((f) => f.key));
  const err = (field: string, code: string, message: string) => errors.push({ field, code, message });

  for (const key of Object.keys(answers)) {
    if (!known.has(key)) err(key, "unknown_field", `Unknown field "${key}"`);
  }
  for (const key of Object.keys(files)) {
    const f = fields.find((x) => x.key === key);
    if (!f) err(key, "unknown_field", `Unknown file field "${key}"`);
    else if (!isFileField(f.type)) err(key, "not_a_file_field", `Field "${key}" does not accept files`);
  }

  for (const f of fields) {
    if (isFileField(f.type)) {
      const list = files[f.key] ?? [];
      if (f.key in answers) err(f.key, "file_required", `Field "${f.key}" must be uploaded as a file (multipart files[${f.key}])`);
      if (f.required && list.length === 0) {
        err(f.key, "required", `${f.label} is required`);
        continue;
      }
      if (!f.multiple && list.length > 1) err(f.key, "too_many_files", `${f.label} accepts a single file`);
      const maxMb = f.maxFileSizeMb ?? DEFAULT_FILE_MB;
      for (const file of list) {
        if (file.size > maxMb * 1024 * 1024) err(f.key, "file_too_large", `${f.label}: ${file.name} exceeds ${maxMb} MB`);
        if (file.size === 0) err(f.key, "empty_file", `${f.label}: ${file.name} is empty`);
        const allowed = (f.allowedFileTypes ?? []).map((t) => t.toLowerCase().replace(/^\./, ""));
        if (allowed.length > 0) {
          const e = ext(file.name);
          const detected = file.detected;
          const extOk = allowed.includes(e);
          const same = (a: string, b: string) => a === b || (["jpg", "jpeg"].includes(a) && ["jpg", "jpeg"].includes(b));
          const magicOk = detected === undefined || detected === null || allowed.some((a) => same(a, detected));
          if (!extOk || !magicOk)
            err(f.key, "invalid_file_type", `${f.label}: ${file.name} must be one of ${allowed.join(", ")}`);
        }
      }
      continue;
    }

    let v = answers[f.key];
    if (isEmpty(v) && f.defaultValue !== undefined && f.defaultValue !== "") v = f.defaultValue;

    if (isEmpty(v) || ((f.type === "checkbox" || f.type === "consent") && (v === false || v === "false"))) {
      if (f.required) {
        err(f.key, "required", f.type === "consent" ? `${f.label}: consent is required` : `${f.label} is required`);
      } else if (f.type === "checkbox" || f.type === "consent") {
        values[f.key] = false;
      }
      continue;
    }

    switch (f.type) {
      case "short_text":
      case "long_text":
      case "email":
      case "phone":
      case "url":
      case "date": {
        if (typeof v !== "string" && typeof v !== "number") {
          err(f.key, "invalid_type", `${f.label} must be a string`);
          break;
        }
        const s = String(v).trim();
        const maxDefault = f.type === "long_text" ? 10000 : 500;
        if (f.minLength != null && s.length < f.minLength) err(f.key, "too_short", `${f.label} must be at least ${f.minLength} characters`);
        if (s.length > (f.maxLength ?? maxDefault)) err(f.key, "too_long", `${f.label} must be at most ${f.maxLength ?? maxDefault} characters`);
        if (f.type === "email" && !EMAIL_RE.test(s)) err(f.key, "invalid_email", `${f.label} must be a valid email address`);
        if (f.type === "phone" && !PHONE_RE.test(s)) err(f.key, "invalid_phone", `${f.label} must be a valid phone number`);
        if (f.type === "url") {
          let ok = false;
          try { const u = new URL(s); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { ok = false; }
          if (!ok) err(f.key, "invalid_url", `${f.label} must be a valid http(s) URL`);
        }
        if (f.type === "date" && (!DATE_RE.test(s) || Number.isNaN(Date.parse(s)))) err(f.key, "invalid_date", `${f.label} must be a date (YYYY-MM-DD)`);
        if (f.pattern) {
          try {
            if (!new RegExp(f.pattern).test(s)) err(f.key, "pattern_mismatch", f.patternMessage || `${f.label} has an invalid format`);
          } catch { /* invalid pattern ignored */ }
        }
        values[f.key] = s;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(String(v).trim());
        if (!Number.isFinite(n)) { err(f.key, "invalid_number", `${f.label} must be a number`); break; }
        if (f.min != null && n < f.min) err(f.key, "too_small", `${f.label} must be ≥ ${f.min}`);
        if (f.max != null && n > f.max) err(f.key, "too_large", `${f.label} must be ≤ ${f.max}`);
        values[f.key] = n;
        break;
      }
      case "dropdown":
      case "single_select": {
        const s = Array.isArray(v) ? v[0] : v;
        if (typeof s !== "string" || !(f.options ?? []).includes(s))
          err(f.key, "invalid_option", `${f.label} must be one of: ${(f.options ?? []).join(", ")}`);
        else values[f.key] = s;
        break;
      }
      case "multi_select": {
        let arr: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? (v.trim().startsWith("[") ? safeJsonArray(v) : v.split(",").map((x) => x.trim()).filter(Boolean)) : [v];
        arr = Array.from(new Set(arr));
        const bad = arr.filter((x) => typeof x !== "string" || !(f.options ?? []).includes(x));
        if (bad.length) err(f.key, "invalid_option", `${f.label}: invalid option(s) ${bad.join(", ")}. Allowed: ${(f.options ?? []).join(", ")}`);
        if (f.min != null && arr.length < f.min) err(f.key, "too_few", `${f.label}: select at least ${f.min}`);
        if (f.max != null && arr.length > f.max) err(f.key, "too_many", `${f.label}: select at most ${f.max}`);
        values[f.key] = arr;
        break;
      }
      case "checkbox":
      case "consent": {
        const b = v === true || v === "true" || v === "on" || v === "1" || v === 1 || v === "yes";
        if (!b && v !== false && v !== "false" && v !== "0" && v !== 0) err(f.key, "invalid_boolean", `${f.label} must be true or false`);
        values[f.key] = b;
        break;
      }
    }
  }
  return { ok: errors.length === 0, errors, values };
}

function safeJsonArray(s: string): unknown[] {
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : [a]; } catch { return [s]; }
}

/** Magic-byte sniffing for common document/image types. */
export function sniffFileType(bytes: Uint8Array): string | null {
  const b = bytes;
  const starts = (...sig: number[]) => sig.every((x, i) => b[i] === x);
  if (starts(0x25, 0x50, 0x44, 0x46)) return "pdf";
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "zip"; // docx/xlsx/pptx/odt
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return "doc";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "png";
  if (starts(0xff, 0xd8, 0xff)) return "jpg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return "webp";
  if (starts(0x7b, 0x5c, 0x72, 0x74, 0x66)) return "rtf";
  // text-like: no NUL bytes in first 512 bytes
  const n = Math.min(b.length, 512);
  for (let i = 0; i < n; i++) if (b[i] === 0) return "binary";
  return "txt";
}

/** Map detected magic type onto the allowed list semantics (jpeg==jpg, md/csv are txt). */
export function normaliseDetected(detected: string | null, filename: string): string | null {
  if (!detected) return null;
  const e = ext(filename);
  if (detected === "jpg" && e === "jpeg") return "jpeg";
  if (detected === "txt" && ["txt", "md", "csv", "json"].includes(e)) return e;
  if (detected === "zip" && ["docx", "xlsx", "pptx", "odt"].includes(e)) return e;
  return detected;
}

// ── Application lifecycle ───────────────────────────────────────────────
export type ApplicationStatus =
  | "submitted"
  | "pending"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "disqualified";

export function deriveApplicationStatus(
  stored: string,
  session: { status?: string | null } | null | undefined,
): ApplicationStatus {
  if (stored === "cancelled") return "cancelled";
  if (session?.status) {
    switch (session.status) {
      case "IN_PROGRESS": return "in_progress";
      case "COMPLETED": return "completed";
      case "DISQUALIFIED": return "disqualified";
      case "ABANDONED": return "cancelled";
    }
  }
  return (["submitted", "pending", "scheduled"].includes(stored) ? stored : "pending") as ApplicationStatus;
}

// ── Integration docs / cURL generation ──────────────────────────────────
function sampleValue(f: FormField): unknown {
  switch (f.type) {
    case "email": return "jane@example.com";
    case "phone": return "+15551234567";
    case "number": return f.min != null ? Math.max(f.min, 3) : 3;
    case "url": return "https://example.com/portfolio";
    case "date": return "2026-01-15";
    case "long_text": return "Lorem ipsum…";
    case "dropdown":
    case "single_select": return f.options?.[0] ?? "";
    case "multi_select": return (f.options ?? []).slice(0, 2);
    case "checkbox":
    case "consent": return true;
    default: return f.key === "full_name" ? "Jane Doe" : `Sample ${f.label}`;
  }
}

export function fieldTypeForDocs(f: FormField): string {
  if (isFileField(f.type)) return "file";
  switch (f.type) {
    case "number": return "number";
    case "multi_select": return "string[]";
    case "checkbox":
    case "consent": return "boolean";
    default: return "string";
  }
}

export function buildJsonExample(fields: FormField[]) {
  const visible = fields.filter((f) => !isFileField(f.type));
  const answers: Record<string, unknown> = {};
  for (const f of visible) {
    if (f.key === CANDIDATE_KEYS.name || f.key === CANDIDATE_KEYS.email || f.key === CANDIDATE_KEYS.phone) continue;
    answers[f.key] = sampleValue(f);
  }
  return {
    candidate: { name: "Jane Doe", email: "jane@example.com", phone: "+15551234567" },
    answers,
  };
}

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function buildCurlJson(baseUrl: string, formPublicId: string, fields: FormField[], apiKeyPlaceholder = "YOUR_API_KEY"): string {
  const body = JSON.stringify(buildJsonExample(fields), null, 2);
  return [
    `curl -X POST "${baseUrl}/api/v1/interview-forms/${formPublicId}/applications" \\`,
    `  -H "Authorization: Bearer ${apiKeyPlaceholder}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d ${shq(body)}`,
  ].join("\n");
}

export function buildCurlMultipart(baseUrl: string, formPublicId: string, fields: FormField[], apiKeyPlaceholder = "YOUR_API_KEY"): string {
  const ex = buildJsonExample(fields);
  const lines = [
    `curl -X POST "${baseUrl}/api/v1/interview-forms/${formPublicId}/applications" \\`,
    `  -H "Authorization: Bearer ${apiKeyPlaceholder}" \\`,
    `  -F ${shq(`candidate[name]=${ex.candidate.name}`)} \\`,
    `  -F ${shq(`candidate[email]=${ex.candidate.email}`)} \\`,
    `  -F ${shq(`candidate[phone]=${ex.candidate.phone}`)} \\`,
  ];
  for (const [k, v] of Object.entries(ex.answers)) {
    if (Array.isArray(v)) for (const item of v) lines.push(`  -F ${shq(`answers[${k}][]=${item}`)} \\`);
    else lines.push(`  -F ${shq(`answers[${k}]=${String(v)}`)} \\`);
  }
  for (const f of fields.filter((x) => isFileField(x.type))) {
    const e = f.allowedFileTypes?.[0] ?? "pdf";
    lines.push(`  -F ${shq(`files[${f.key}]=@./${f.key}.${e}`)} \\`);
  }
  lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, "");
  return lines.join("\n");
}

export function buildSuccessExample(baseUrl: string, formPublicId: string) {
  return {
    data: {
      id: "app_xxxxxxxxxxxxxxxx",
      form_id: formPublicId,
      status: "pending",
      environment: "live",
      candidate: { name: "Jane Doe", email: "jane@example.com", phone: "+15551234567" },
      interview_url: `${baseUrl}/i/invite/xxxxxxxxxxxx`,
      created_at: "2026-10-28T12:00:00.000Z",
    },
  };
}

export const ERROR_EXAMPLES = {
  validation: {
    status: 422,
    body: { error: { code: "VALIDATION_ERROR", message: "Submission failed validation", details: [{ field: "resume", code: "required", message: "Resume / CV is required" }] } },
  },
  unauthorized: { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Invalid or revoked API key." } } },
  forbidden: { status: 403, body: { error: { code: "FORBIDDEN", message: "This API key cannot access this form" } } },
  notFound: { status: 404, body: { error: { code: "NOT_FOUND", message: "Form not found" } } },
  notPublished: { status: 409, body: { error: { code: "FORM_NOT_PUBLISHED", message: "This form is not published" } } },
  tooLarge: { status: 413, body: { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 25 MB" } } },
  rateLimited: { status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many requests. Retry after 30s." } } },
};
