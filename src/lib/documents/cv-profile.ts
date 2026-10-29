/**
 * CV Markdown → validated candidate profile.
 *
 * The LLM only structures text that is already in the document. Every
 * identity/contact value is then checked against the source text; values the
 * model can't back up are dropped and flagged rather than kept as guesses.
 */
import { extractJson } from "@/lib/ai/extract-json";
import { GENERATOR_MODEL, getProvider } from "@/lib/ai/registry";

export interface ReviewFlag {
  field: string;
  reason: string;
}

export interface CvExperience {
  company: string | null;
  role: string | null;
  start: string | null;
  end: string | null;
  summary: string | null;
}

export interface CvProject {
  name: string;
  description: string | null;
  technologies: string[];
}

export interface CvEducation {
  institution: string | null;
  degree: string | null;
  field: string | null;
  graduationYear: number | null;
}

export interface CandidateProfile {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  totalExperienceYears: number | null;
  techStack: string[];
  experience: CvExperience[];
  projects: CvProject[];
  education: CvEducation[];
  summary: string | null;
}

/** Highest-signal slice sent to the LLM; CVs rarely need more. */
const MAX_SOURCE_CHARS = 24_000;

const SYSTEM_PROMPT = `You convert a CV/resume (given as Markdown) into JSON. Use ONLY information present in the text.

Return exactly this shape:
{
  "name": string | null,
  "email": string | null,
  "phone": string | null,              // as printed, including country code if present
  "location": string | null,
  "headline": string | null,           // current title / one-line role
  "totalExperienceYears": number | null, // only if stated or computable from listed dates
  "techStack": string[],               // languages, frameworks, tools, platforms
  "experience": [{ "company": string|null, "role": string|null, "start": string|null, "end": string|null, "summary": string|null }],
  "projects": [{ "name": string, "description": string|null, "technologies": string[] }],
  "education": [{ "institution": string|null, "degree": string|null, "field": string|null, "graduationYear": number|null }],
  "summary": string | null,            // 1-2 sentence factual summary
  "uncertain": [{ "field": string, "reason": string }] // anything unreadable, ambiguous or "[unreadable]" in the source
}

Rules:
- Never guess or infer missing values. Use null / [] instead.
- Copy emails, phone numbers, dates and numbers character-for-character.
- Keep experience in the order listed. Use "Present" for current roles only if the CV says so.
- Return only the JSON object.`;

export async function extractCandidateProfile(
  markdown: string,
  options: { defaultCountryCode?: string } = {},
): Promise<{ profile: CandidateProfile; reviewFlags: ReviewFlag[] }> {
  const source = markdown.slice(0, MAX_SOURCE_CHARS);
  const provider = getProvider(GENERATOR_MODEL);
  const res = await provider.generateResponse({
    model: GENERATOR_MODEL,
    temperature: 0,
    maxTokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: source },
    ],
  });

  const raw = extractJson<Record<string, unknown>>(res.content.replace(/<think>[\s\S]*?<\/think>/g, ""));
  return validateProfile(raw, source, options.defaultCountryCode);
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function str(v: unknown, max = 300): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.toLowerCase() !== "null" ? t.slice(0, max) : null;
}

function strArr(v: unknown, max = 60): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const s = str(item, 80);
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out.slice(0, max);
}

function year(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  const max = new Date().getFullYear() + 6;
  return Number.isInteger(n) && n >= 1950 && n <= max ? n : null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.+]/g, "");
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Normalises a phone to `+<country><number>` (WhatsApp needs a country code).
 * Returns null when it isn't a plausible phone number.
 */
export function normalisePhone(
  raw: string,
  defaultCountryCode?: string,
): { phone: string | null; assumedCountry: boolean } {
  const hasPlus = raw.trim().startsWith("+") || raw.trim().startsWith("00");
  let d = digits(raw);
  if (raw.trim().startsWith("00")) d = d.slice(2);
  if (d.length < 8 || d.length > 15) return { phone: null, assumedCountry: false };
  if (hasPlus) return { phone: `+${d}`, assumedCountry: false };

  const cc = digits(defaultCountryCode ?? "");
  if (cc && d.startsWith(cc) && d.length > cc.length + 7) return { phone: `+${d}`, assumedCountry: false };
  if (cc) return { phone: `+${cc}${d.replace(/^0+/, "")}`, assumedCountry: true };
  return { phone: d, assumedCountry: false };
}

export function validateProfile(
  raw: Record<string, unknown>,
  source: string,
  defaultCountryCode?: string,
): { profile: CandidateProfile; reviewFlags: ReviewFlag[] } {
  const flags: ReviewFlag[] = [];
  const srcSquashed = squash(source);
  const srcDigits = digits(source);

  // Name: must appear in the document.
  let name = str(raw.name, 120);
  if (name && !srcSquashed.includes(squash(name))) {
    flags.push({ field: "name", reason: `"${name}" not found verbatim in the CV` });
    name = null;
  }
  if (!name) flags.push({ field: "name", reason: "Name missing — enter it manually" });

  // Email: format + must appear in the document.
  let email = str(raw.email, 200)?.toLowerCase().replace(/^mailto:/, "") ?? null;
  if (email && !EMAIL_RE.test(email)) {
    flags.push({ field: "email", reason: `"${email}" is not a valid email address` });
    email = null;
  } else if (email && !srcSquashed.includes(squash(email))) {
    flags.push({ field: "email", reason: `"${email}" not found in the CV` });
    email = null;
  }
  if (!email) flags.push({ field: "email", reason: "No email found — needed for email invites" });

  // Phone: digits must appear in the document; normalise for WhatsApp.
  let phone: string | null = null;
  const rawPhone = str(raw.phone, 40);
  if (rawPhone) {
    const d = digits(rawPhone);
    if (!srcDigits.includes(d.slice(-8))) {
      flags.push({ field: "phone", reason: `"${rawPhone}" not found in the CV` });
    } else {
      const n = normalisePhone(rawPhone, defaultCountryCode);
      phone = n.phone;
      if (!phone) flags.push({ field: "phone", reason: `"${rawPhone}" is not a valid phone number` });
      else if (n.assumedCountry) flags.push({ field: "phone", reason: `Country code +${digits(defaultCountryCode ?? "")} assumed — please confirm` });
      else if (!phone.startsWith("+")) flags.push({ field: "phone", reason: "No country code — add one for WhatsApp" });
    }
  }
  if (!phone && !rawPhone) flags.push({ field: "phone", reason: "No phone found — needed for WhatsApp invites" });

  let totalExperienceYears: number | null = null;
  if (typeof raw.totalExperienceYears === "number" && Number.isFinite(raw.totalExperienceYears)) {
    if (raw.totalExperienceYears >= 0 && raw.totalExperienceYears <= 60) {
      totalExperienceYears = Math.round(raw.totalExperienceYears * 10) / 10;
    } else {
      flags.push({ field: "totalExperienceYears", reason: `Implausible value ${raw.totalExperienceYears}` });
    }
  }

  const experience: CvExperience[] = (Array.isArray(raw.experience) ? raw.experience : [])
    .slice(0, 20)
    .map((e) => {
      const r = (e ?? {}) as Record<string, unknown>;
      return {
        company: str(r.company, 120),
        role: str(r.role, 120),
        start: str(r.start, 30),
        end: str(r.end, 30),
        summary: str(r.summary, 600),
      };
    })
    .filter((e) => e.company || e.role);

  const projects: CvProject[] = (Array.isArray(raw.projects) ? raw.projects : [])
    .slice(0, 20)
    .map((p) => {
      const r = (p ?? {}) as Record<string, unknown>;
      return { name: str(r.name, 120) ?? "", description: str(r.description, 600), technologies: strArr(r.technologies, 20) };
    })
    .filter((p) => p.name);

  const education: CvEducation[] = (Array.isArray(raw.education) ? raw.education : [])
    .slice(0, 10)
    .map((e) => {
      const r = (e ?? {}) as Record<string, unknown>;
      const gy = r.graduationYear == null ? null : year(r.graduationYear);
      if (r.graduationYear != null && gy == null) {
        flags.push({ field: "education.graduationYear", reason: `Implausible year "${String(r.graduationYear)}"` });
      }
      return { institution: str(r.institution, 160), degree: str(r.degree, 120), field: str(r.field, 120), graduationYear: gy };
    })
    .filter((e) => e.institution || e.degree);

  if (Array.isArray(raw.uncertain)) {
    for (const u of raw.uncertain.slice(0, 10)) {
      const r = (u ?? {}) as Record<string, unknown>;
      const field = str(r.field, 60);
      const reason = str(r.reason, 200);
      if (field && reason) flags.push({ field, reason });
    }
  }
  if (source.includes("[unreadable]")) {
    flags.push({ field: "document", reason: "Parts of the document were unreadable" });
  }

  return {
    profile: {
      name,
      email,
      phone,
      location: str(raw.location, 120),
      headline: str(raw.headline, 160),
      totalExperienceYears,
      techStack: strArr(raw.techStack),
      experience,
      projects,
      education,
      summary: str(raw.summary, 600),
    },
    reviewFlags: flags,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers for downstream use                                         */
/* ------------------------------------------------------------------ */

/** Maps years of experience to the candidate table's existing buckets. */
export function experienceBucket(years: number | null): string | undefined {
  if (years == null) return undefined;
  if (years < 1) return "Less than one year";
  if (years < 3) return "1 - 3 years";
  if (years < 5) return "3 - 5 years";
  if (years < 10) return "5 - 10 years";
  return "More than 10 years";
}

/** Compact Markdown rendering fed to the question generator. */
export function profileToResumeText(p: CandidateProfile): string {
  const lines: string[] = [];
  if (p.name) lines.push(`# ${p.name}`);
  if (p.headline) lines.push(p.headline);
  if (p.totalExperienceYears != null) lines.push(`Total experience: ${p.totalExperienceYears} years`);
  if (p.summary) lines.push(`\n${p.summary}`);
  if (p.techStack.length) lines.push(`\n## Tech stack\n${p.techStack.join(", ")}`);
  if (p.experience.length) {
    lines.push("\n## Experience");
    for (const e of p.experience) {
      lines.push(`- ${[e.role, e.company].filter(Boolean).join(" @ ")} (${e.start ?? "?"} – ${e.end ?? "?"})${e.summary ? `: ${e.summary}` : ""}`);
    }
  }
  if (p.projects.length) {
    lines.push("\n## Projects");
    for (const pr of p.projects) {
      lines.push(`- ${pr.name}${pr.technologies.length ? ` [${pr.technologies.join(", ")}]` : ""}${pr.description ? `: ${pr.description}` : ""}`);
    }
  }
  if (p.education.length) {
    lines.push("\n## Education");
    for (const e of p.education) {
      lines.push(`- ${[e.degree, e.field].filter(Boolean).join(", ")} — ${e.institution ?? ""}${e.graduationYear ? ` (${e.graduationYear})` : ""}`);
    }
  }
  return lines.join("\n");
}
