/**
 * Shared rules for choosing a candidate name from a CV.
 *
 * PDF extraction injects `<!-- page N -->` markers, and many resumes also
 * print "Page 1" as a header/footer or use a generic file/title ("Resume",
 * "Microsoft Word - …"). Those strings must never be stored as the name.
 */
export function stripPageDecorations(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*page\s+\d+(?:\s*(?:of|\/)\s*\d+)?\s*$/gim, "")
    .replace(/^\s*-{1,3}\s*\d+\s*(?:of|\/)\s*\d+\s*-{1,3}\s*$/gim, "")
    .replace(/^\s*\d+\s*(?:of|\/)\s*\d+\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const JUNK_EXACT = new Set(
  [
    "untitled",
    "document",
    "resume",
    "cv",
    "curriculum vitae",
    "curriculum vitae (cv)",
    "biodata",
    "bio data",
    "bio-data",
    "confidential",
    "personal details",
    "personal information",
    "personal profile",
    "contact",
    "contact information",
    "contact details",
    "contact me",
    "profile",
    "professional profile",
    "objective",
    "career objective",
    "career summary",
    "summary",
    "professional summary",
    "about me",
    "about",
    "work experience",
    "experience",
    "education",
    "skills",
    "technical skills",
    "declaration",
    "references",
    "projects",
    "certifications",
    "achievements",
    "internships",
    "languages",
    "hobbies",
    "address",
    "phone",
    "email",
    "name",
    "date of birth",
    "dob",
    "nationality",
    "gender",
    "father",
    "mother",
    "marital status",
  ].map((s) => s.toLowerCase()),
);

const JOB_TITLE =
  /^(?:(?:senior|junior|lead|principal|staff|associate|assistant|chief)\s+)?(?:software|full[\s-]?stack|front[\s-]?end|back[\s-]?end|data|product|project|human resources|business|marketing|sales|quality|technical|devops|cloud)?\s*(?:engineer|developer|programmer|manager|analyst|consultant|intern|designer|architect|specialist|executive|officer|director|founder|student|graduate|fresher)s?(?:\s*[-|/].*)?$/i;

const NAME_WORD = /^[\p{L}][\p{L}.''’\u0900-\u097F-]*\.?$/u;

export function isPlausiblePersonName(raw: string | null | undefined): boolean {
  if (!raw) return false;
  if (/<!--/.test(raw) || /-->/.test(raw)) return false;
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 80) return false;
  if (/@/.test(s) || /https?:\/\//i.test(s)) return false;
  if (/^page\s*\d+(?:\s*(?:of|\/|-)\s*\d+)?$/i.test(s)) return false;
  if (/^\d+\s*(?:of|\/)\s*\d+$/i.test(s)) return false;
  if (/^-+\s*\d+\s*(?:of|\/)\s*\d+\s*-+$/i.test(s)) return false;
  if (/\.(pdf|docx?|txt|md|rtf|pages)$/i.test(s)) return false;
  if (/^microsoft\s+word\b/i.test(s)) return false;
  if (JUNK_EXACT.has(s.toLowerCase())) return false;
  if (JOB_TITLE.test(s)) return false;
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return false;
  const words = s.split(/\s+/);
  if (words.length > 6) return false;
  return words.every((w) => NAME_WORD.test(w));
}

export function prettifyName(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (!letters) return t;
  const uniform = letters === letters.toUpperCase() || letters === letters.toLowerCase();
  if (!uniform) return t;
  return t.split(" ").map(titleCaseWord).join(" ");
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  if (/^[A-Za-z]\.$/.test(w)) return w.toUpperCase();
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

const EMAIL_LINE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** First usable person name in already-extracted CV text. */
export function firstPlausibleNameFromSource(source: string): string | null {
  const lines = stripPageDecorations(source)
    .split(/\n/)
    .map((l) => l.replace(/^#+\s*/, "").replace(/[*_`]+/g, "").trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 20)) {
    if (EMAIL_LINE.test(line)) continue;
    if (/https?:\/\//i.test(line)) continue;
    if (/\d{6,}/.test(line)) continue;
    const candidate = (line.split(/[|,•·]/)[0] ?? line).trim();
    const pretty = prettifyName(candidate);
    if (isPlausiblePersonName(pretty)) return pretty;
  }
  return null;
}

const GENERIC_EMAIL_LOCAL = new Set([
  "info",
  "hr",
  "admin",
  "contact",
  "mail",
  "official",
  "apply",
  "career",
  "careers",
  "jobs",
  "resume",
  "cv",
  "hello",
  "hi",
  "me",
  "user",
  "noreply",
  "no-reply",
  "team",
]);

export function nameFromEmailLocalPart(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const local = email.split("@")[0]?.split("+")[0] ?? "";
  const stripped = local.replace(/\d+$/g, "");
  const parts = stripped
    .split(/[._-]+/)
    .map((p) => p.trim())
    .filter((p) => p && !GENERIC_EMAIL_LOCAL.has(p.toLowerCase()) && !/^\d+$/.test(p));
  if (!parts.length || parts.length > 4) return null;
  const name = prettifyName(parts.join(" "));
  return isPlausiblePersonName(name) ? name : null;
}

const FILE_JUNK =
  /^(resume|cv|curriculum|vitae|biodata|bio-data|updated|update|final|copy|draft|new|old|latest|scan|scanned|doc|document|untitled|microsoft|word|v\d+|ver\d+|\(\d+\))$/i;

export function nameFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const withoutExt = base.replace(/\.(pdf|docx?|txt|md|rtf|pages)$/i, "");
  const cleaned = withoutExt
    .replace(/^microsoft\s+word\s*-\s*/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned
    .split(" ")
    .filter((p) => p && !FILE_JUNK.test(p) && !/^\d+$/.test(p));
  if (!parts.length) return null;
  const name = prettifyName(parts.join(" "));
  return isPlausiblePersonName(name) ? name : null;
}

export type NameSource = "provided" | "text" | "email" | "fileName";

export function resolveCandidateName(opts: {
  candidate?: string | null;
  source?: string | null;
  email?: string | null;
  fileName?: string | null;
}): { name: string | null; source: NameSource | null } {
  const providedRaw = opts.candidate?.trim() || null;
  const provided = providedRaw ? prettifyName(providedRaw) : null;
  if (provided && isPlausiblePersonName(provided)) return { name: provided, source: "provided" };
  const fromText = opts.source ? firstPlausibleNameFromSource(opts.source) : null;
  if (fromText) return { name: fromText, source: "text" };
  const fromEmail = nameFromEmailLocalPart(opts.email);
  if (fromEmail) return { name: fromEmail, source: "email" };
  const fromFile = nameFromFileName(opts.fileName);
  if (fromFile) return { name: fromFile, source: "fileName" };
  return { name: null, source: null };
}

/** True when a stored candidate name looks like a page marker or other placeholder. */
export function isJunkStoredName(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true;
  const t = name.trim();
  // Raw HTML comment / page marker even if other checks somehow pass.
  if (/<!--/.test(t) || /-->/.test(t)) return true;
  if (/^page\s*\d+(?:\s*(?:of|\/|-)\s*\d+)?$/i.test(t)) return true;
  return !isPlausiblePersonName(prettifyName(t)) && !isPlausiblePersonName(t);
}

/**
 * Batch interviews store `"{role title} · {candidateName}"`. If the name was a
 * PDF page marker, strip that junk suffix for display (and repair scripts).
 */
export function cleanInterviewTitle(title: string | null | undefined): string {
  if (!title?.trim()) return "";
  const raw = title.trim();
  // Drop any embedded page comments anywhere in the title.
  let t = raw.replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/\s*[·•]\s*$/g, "").trim();

  const parts = t.split(/\s*[·•]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return t || raw.replace(/<!--[\s\S]*?-->/g, "").trim();

  const head = parts.slice(0, -1).join(" · ");
  const tail = parts[parts.length - 1]!;
  if (isJunkStoredName(tail)) return head || t;
  return t;
}

/** Resolve a usable person name for batch create; never returns page-marker junk. */
export function sanitizeContactName(opts: {
  name?: string | null;
  source?: string | null;
  email?: string | null;
  fileName?: string | null;
}): string | null {
  const resolved = resolveCandidateName({
    candidate: opts.name,
    source: opts.source,
    email: opts.email,
    fileName: opts.fileName,
  });
  if (resolved.name && !isJunkStoredName(resolved.name)) return resolved.name;
  return null;
}
