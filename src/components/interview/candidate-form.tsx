"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
    AlertCircle,
    AlertTriangle,
    Briefcase,
    CalendarIcon,
    ChevronLeft,
    ChevronRight,
    GraduationCap,
    IdCard,
    Mail,
    Sparkles,
    User,
    Wrench,
    X,
} from "lucide-react";
import { useState } from "react";

/* Shared candidate form used by "Create individually", "Import by Resumes" and "Bulk upload". */

export const EDUCATION_OPTIONS = ["College", "Bachelor", "Master", "PhD", "MBA", "Other"];
export const WORK_EXPERIENCE_OPTIONS = [
  "Less than one year",
  "1 - 3 years",
  "3 - 5 years",
  "5 - 10 years",
  "More than 10 years",
];
export const GENDER_OPTIONS = ["Male", "Female", "Other"];

const currentYear = new Date().getFullYear();
const GRADUATION_YEARS = Array.from({ length: 50 }, (_, i) => currentYear - 40 + i);

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const BIRTHDAY_YEAR_MIN = currentYear - 78;
const BIRTHDAY_YEAR_MAX = currentYear - 18;

export function MonthYearPicker({
  year,
  month,
  onChangeYear,
  onChangeMonth,
  placeholder,
  yearMin,
  yearMax,
}: {
  year: string;
  month: string;
  onChangeYear: (y: string) => void;
  onChangeMonth: (m: string) => void;
  placeholder: string;
  yearMin: number;
  yearMax: number;
}) {
  const [pickerYear, setPickerYear] = useState(
    year ? parseInt(year) : currentYear - 25,
  );
  const [open, setOpen] = useState(false);

  const displayValue =
    year && month ? `${year}/${month}` : year ? year : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-9 w-full justify-start text-left text-sm font-normal",
            !displayValue && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5" />
          {displayValue || placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setPickerYear((y) => Math.max(yearMin, y - 1))}
            disabled={pickerYear <= yearMin}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">{pickerYear}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setPickerYear((y) => Math.min(yearMax, y + 1))}
            disabled={pickerYear >= yearMax}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MONTH_LABELS.map((label, i) => {
            const mVal = String(i + 1).padStart(2, "0");
            const isSelected = String(pickerYear) === year && mVal === month;
            return (
              <Button
                key={label}
                type="button"
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  onChangeYear(String(pickerYear));
                  onChangeMonth(mVal);
                  setOpen(false);
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}


export const EMPTY_CANDIDATE_FORM = {
  name: "",
  email: "",
  phone: "",
  gender: "",
  birthdayYear: "",
  birthdayMonth: "",
  education: "",
  school: "",
  major: "",
  graduationYear: "",
  workExperience: "",
  notes: "",
  skills: [] as string[],
  tailor: true,
};
export type CandidateFormState = typeof EMPTY_CANDIDATE_FORM;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const cleanPhone = (p: string) => p.replace(/[\s()-]/g, "");

export function validateCandidateForm(f: CandidateFormState): Record<string, string> {
  const err: Record<string, string> = {};
  if (!f.name.trim()) err.name = "Name is required";
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) err.email = "Invalid email";
  const ph = cleanPhone(f.phone);
  if (ph && !/^\+\d{7,15}$/.test(ph)) err.phone = "Use + and country code, e.g. +919876543210";
  return err;
}

/** Merge AI-parsed resume JSON into a form state. */
export function parsedToForm(data: Record<string, unknown>, base: CandidateFormState = EMPTY_CANDIDATE_FORM): CandidateFormState {
  const next: CandidateFormState = { ...base, skills: [...base.skills] };
  if (data.name && typeof data.name === "string") next.name = data.name;
  if (data.email && typeof data.email === "string") next.email = data.email;
  if (data.phone && (typeof data.phone === "string" || typeof data.phone === "number")) next.phone = String(data.phone);
  if (typeof data.gender === "string" && GENDER_OPTIONS.includes(data.gender)) next.gender = data.gender;
  if (typeof data.birthday === "string" && data.birthday) {
    const parts = data.birthday.split("-");
    if (parts[0]) next.birthdayYear = parts[0];
    if (parts[1]) next.birthdayMonth = parts[1].padStart(2, "0");
  }
  if (typeof data.education === "string" && EDUCATION_OPTIONS.includes(data.education)) next.education = data.education;
  if (data.school && typeof data.school === "string") next.school = data.school;
  if (data.major && typeof data.major === "string") next.major = data.major;
  if (data.graduationYear != null && data.graduationYear !== "") next.graduationYear = String(data.graduationYear);
  if (typeof data.workExperience === "string" && WORK_EXPERIENCE_OPTIONS.includes(data.workExperience))
    next.workExperience = data.workExperience;
  if (data.notes && typeof data.notes === "string") next.notes = data.notes;
  if (Array.isArray(data.skills)) {
    const seen = new Set(next.skills.map((s) => s.toLowerCase()));
    for (const s of data.skills) {
      if (typeof s === "string" && s.trim() && !seen.has(s.trim().toLowerCase())) {
        seen.add(s.trim().toLowerCase());
        next.skills.push(s.trim());
      }
    }
  }
  return next;
}

/** Form state → candidate.create / bulkCreate payload. */
export function formToCandidateInput(f: CandidateFormState) {
  return {
    name: f.name.trim(),
    email: f.email.trim() || undefined,
    phone: cleanPhone(f.phone.trim()) || undefined,
    gender: f.gender || undefined,
    birthday: f.birthdayYear && f.birthdayMonth ? `${f.birthdayYear}-${f.birthdayMonth}` : undefined,
    education: f.education || undefined,
    school: f.school.trim() || undefined,
    major: f.major.trim() || undefined,
    graduationYear: f.graduationYear ? parseInt(f.graduationYear, 10) : undefined,
    workExperience: f.workExperience || undefined,
    notes: f.notes.trim() || undefined,
    skills: f.skills,
    tailorInterview: f.tailor,
  };
}

/** Upload one PDF to /api/ai/parse-resume and return the parsed JSON (SSE stream). */
export async function parseResumeFile(
  file: File,
  opts: { organizationId?: string; interviewId?: string; onStream?: (text: string) => void },
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append("file", file);
  if (opts.organizationId) formData.append("organizationId", opts.organizationId);
  if (opts.interviewId) formData.append("interviewId", opts.interviewId);
  const res = await fetch("/api/ai/parse-resume", { method: "POST", body: formData });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as { error?: string }).error || "Failed to parse resume");
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";
  let streamError = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const { token, error } = JSON.parse(payload);
        if (error) streamError = String(error);
        if (token) {
          accumulated += token;
          opts.onStream?.(accumulated);
        }
      } catch {
        // skip malformed SSE
      }
    }
  }
  const cleaned = accumulated.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(streamError || "AI response was not valid JSON. Please try again.");
  }
}

export function SkillChips({
  id,
  skills,
  onChange,
}: {
  id?: string;
  skills: string[];
  onChange: (skills: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(skills.map((s) => s.toLowerCase()));
    onChange([...skills, ...parts.filter((p) => !lower.has(p.toLowerCase()))].slice(0, 30));
    setDraft("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
      {skills.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          {s}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onChange(skills.filter((x) => x !== s))}
            aria-label={`Remove ${s}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && skills.length) {
            onChange(skills.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        placeholder={skills.length ? "Add skill…" : "Type a skill and press Enter"}
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export const COUNTRY_CODES = [
  { code: "+91", label: "IN +91" },
  { code: "+1", label: "US/CA +1" },
  { code: "+44", label: "UK +44" },
  { code: "+971", label: "AE +971" },
  { code: "+61", label: "AU +61" },
  { code: "+65", label: "SG +65" },
  { code: "+49", label: "DE +49" },
  { code: "+33", label: "FR +33" },
  { code: "+966", label: "SA +966" },
  { code: "+974", label: "QA +974" },
  { code: "+977", label: "NP +977" },
  { code: "+880", label: "BD +880" },
  { code: "+94", label: "LK +94" },
];

/** Split "+91 98765 43210" → { code: "+91", local: "98765 43210" }. Unknown/missing code → default +91. */
export function splitPhone(phone: string, fallback = "+91"): { code: string; local: string } {
  const p = phone.trim();
  if (p.startsWith("+")) {
    const match = [...COUNTRY_CODES]
      .sort((x, y) => y.code.length - x.code.length)
      .find((c) => p.replace(/[\s()-]/g, "").startsWith(c.code));
    if (match) {
      const digits = p.replace(/[\s()-]/g, "").slice(match.code.length);
      return { code: match.code, local: digits };
    }
    return { code: "custom", local: p };
  }
  // Local Indian numbers often come as 0XXXXXXXXXX
  return { code: fallback, local: p.replace(/^0(?=\d{10}$)/, "") };
}

export function joinPhone(code: string, local: string): string {
  const l = local.trim();
  if (!l) return "";
  if (code === "custom" || l.startsWith("+")) return l;
  return `${code} ${l}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Fields counted for completion % (name, email, phone, gender, dob, degree, school, major, grad year, experience, skills). */
export function completionPercent(f: CandidateFormState): number {
  const checks = [
    !!f.name.trim(),
    !!f.email.trim(),
    !!f.phone.trim(),
    !!f.gender,
    !!(f.birthdayYear && f.birthdayMonth),
    !!f.education,
    !!f.school.trim(),
    !!f.major.trim(),
    !!f.graduationYear,
    !!f.workExperience,
    f.skills.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function PhoneInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const { code, local } = splitPhone(value);
  const [selCode, setSelCode] = useState(code);
  const effective = value.trim() ? code : selCode;
  return (
    <div className="flex gap-1.5">
      <Select
        value={effective}
        onValueChange={(c) => {
          setSelCode(c);
          onChange(joinPhone(c, local));
        }}
      >
        <SelectTrigger className="h-9 w-[104px] shrink-0 text-sm" aria-label="Country code">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COUNTRY_CODES.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              {c.label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Other (+…)</SelectItem>
        </SelectContent>
      </Select>
      <Input
        id={id}
        inputMode="tel"
        placeholder={effective === "custom" ? "+CC number" : "98765 43210"}
        value={local}
        onChange={(e) => onChange(joinPhone(effective, e.target.value))}
        className={cn("h-9 text-sm", invalid && "border-destructive focus-visible:ring-destructive")}
        aria-invalid={invalid}
      />
    </div>
  );
}

function FieldSection({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-sm", className)}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  error,
  missing,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  missing?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : missing ? (
        <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          Missing from resume — please add
        </p>
      ) : null}
    </div>
  );
}

export function TailorToggle({
  form,
  setForm,
  compact = false,
}: {
  form: CandidateFormState;
  setForm: (updater: (prev: CandidateFormState) => CandidateFormState) => void;
  compact?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border bg-muted/30 p-2.5 text-sm", compact && "p-2")}>
      <Switch
        checked={form.tailor}
        onCheckedChange={(v) => setForm((p) => ({ ...p, tailor: v }))}
        className="mt-0.5"
      />
      <span>
        <span className="flex items-center gap-1 font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Tailor interview to resume
        </span>
        {!compact && (
          <span className="block text-xs text-muted-foreground">
            {form.skills.length
              ? "Keeps the interview's questions and adds ~25% skill-specific questions for this candidate."
              : "Add skills to tailor the interview."}
          </span>
        )}
      </span>
    </label>
  );
}

export function CandidateFormFields({
  form,
  setForm,
  idPrefix = "c-",
  errors = {},
  missingHints = false,
  hideSkills = false,
}: {
  form: CandidateFormState;
  setForm: (updater: (prev: CandidateFormState) => CandidateFormState) => void;
  idPrefix?: string;
  errors?: Record<string, string>;
  /** Show amber "missing from resume" hints on empty fields (resume review). */
  missingHints?: boolean;
  /** Skills + tailor are rendered elsewhere (e.g. a header card). */
  hideSkills?: boolean;
}) {
  const update = (field: keyof CandidateFormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));
  const miss = (empty: boolean) => missingHints && empty;
  const inputCls = (err?: string) =>
    cn("h-9 text-sm", err && "border-destructive focus-visible:ring-destructive");

  return (
    <div className="space-y-3">
      <FieldSection icon={User} title="Contact">
        <Field label="Full name" htmlFor={`${idPrefix}name`} required error={errors.name} className="sm:col-span-2">
          <Input
            id={`${idPrefix}name`}
            placeholder="e.g. Priya Sharma"
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className={inputCls(errors.name)}
            aria-invalid={!!errors.name}
          />
        </Field>
        <Field label="Email" htmlFor={`${idPrefix}email`} error={errors.email} missing={miss(!form.email.trim())}>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`${idPrefix}email`}
              type="email"
              placeholder="name@example.com"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              className={cn(inputCls(errors.email), "pl-8")}
              aria-invalid={!!errors.email}
            />
          </div>
        </Field>
        <Field label="Phone (WhatsApp)" htmlFor={`${idPrefix}phone`} error={errors.phone} missing={miss(!form.phone.trim())}>
          <PhoneInput
            id={`${idPrefix}phone`}
            value={form.phone}
            onChange={(v) => update("phone", v)}
            invalid={!!errors.phone}
          />
        </Field>
      </FieldSection>

      <FieldSection icon={IdCard} title="Personal">
        <Field label="Gender" missing={miss(!form.gender)}>
          <Select value={form.gender || undefined} onValueChange={(v) => update("gender", v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Select gender" />
            </SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date of birth" missing={miss(!(form.birthdayYear && form.birthdayMonth))}>
          <MonthYearPicker
            year={form.birthdayYear}
            month={form.birthdayMonth}
            onChangeYear={(y) => update("birthdayYear", y)}
            onChangeMonth={(m) => update("birthdayMonth", m)}
            placeholder="Select month & year"
            yearMin={BIRTHDAY_YEAR_MIN}
            yearMax={BIRTHDAY_YEAR_MAX}
          />
        </Field>
      </FieldSection>

      <FieldSection icon={GraduationCap} title="Education">
        <Field label="Degree" missing={miss(!form.education)}>
          <Select value={form.education || undefined} onValueChange={(v) => update("education", v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Select degree" />
            </SelectTrigger>
            <SelectContent>
              {EDUCATION_OPTIONS.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Graduation year" missing={miss(!form.graduationYear)}>
          <Select value={form.graduationYear || undefined} onValueChange={(v) => update("graduationYear", v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {GRADUATION_YEARS.map((y) => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="School / University" htmlFor={`${idPrefix}school`} missing={miss(!form.school.trim())}>
          <Input
            id={`${idPrefix}school`}
            placeholder="e.g. IIT Bombay"
            value={form.school}
            onChange={(e) => update("school", e.target.value)}
            className={inputCls()}
          />
        </Field>
        <Field label="Major" htmlFor={`${idPrefix}major`} missing={miss(!form.major.trim())}>
          <Input
            id={`${idPrefix}major`}
            placeholder="e.g. Computer Science"
            value={form.major}
            onChange={(e) => update("major", e.target.value)}
            className={inputCls()}
          />
        </Field>
      </FieldSection>

      <FieldSection icon={Briefcase} title="Experience">
        <Field label="Work experience" missing={miss(!form.workExperience)}>
          <Select value={form.workExperience || undefined} onValueChange={(v) => update("workExperience", v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Select experience" />
            </SelectTrigger>
            <SelectContent>
              {WORK_EXPERIENCE_OPTIONS.map((w) => (
                <SelectItem key={w} value={w}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Notes" htmlFor={`${idPrefix}notes`} className="sm:col-span-2">
          <Textarea
            id={`${idPrefix}notes`}
            placeholder="Summary, highlights, anything the interviewer should know"
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            rows={2}
            className="text-sm"
          />
        </Field>
      </FieldSection>

      {!hideSkills && (
        <FieldSection icon={Wrench} title="Skills">
          <Field label="Skills (from resume)" htmlFor={`${idPrefix}skills`} missing={miss(form.skills.length === 0)} className="sm:col-span-2">
            <SkillChips
              id={`${idPrefix}skills`}
              skills={form.skills}
              onChange={(skills) => setForm((p) => ({ ...p, skills }))}
            />
          </Field>
          <div className="sm:col-span-2">
            <TailorToggle form={form} setForm={setForm} />
          </div>
        </FieldSection>
      )}
    </div>
  );
}

export function SendLinkOptions({
  options,
  sendEmail,
  setSendEmail,
  sendWhatsapp,
  setSendWhatsapp,
  email = "",
  phone = "",
  bulk = false,
}: {
  options?: { email: boolean; whatsapp: boolean };
  sendEmail: boolean;
  setSendEmail: (v: boolean) => void;
  sendWhatsapp: boolean;
  setSendWhatsapp: (v: boolean) => void;
  email?: string;
  phone?: string;
  bulk?: boolean;
}) {
  return (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-medium">Send interview link</p>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={sendWhatsapp}
                disabled={!options?.whatsapp}
                onCheckedChange={(v) => setSendWhatsapp(v === true)}
              />
              <span>
                Send link on WhatsApp
                <span className="block text-xs text-muted-foreground">
                  {!options?.whatsapp
                    ? "WhatsApp (ResilioHub) not configured — set it up in Integrations."
                    : !bulk && !phone.trim()
                      ? "Add a phone number with country code (e.g. +91…)."
                      : !bulk && !phone.trim().startsWith("+")
                        ? "Phone must start with + and country code (e.g. +91…)."
                        : (bulk ? "Sent to each candidate\u2019s phone" : `To ${phone.trim()}`)}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={sendEmail}
                disabled={!options?.email}
                onCheckedChange={(v) => setSendEmail(v === true)}
              />
              <span>
                Send link by Email
                <span className="block text-xs text-muted-foreground">
                  {!options?.email
                    ? "No email sender (Resend/Brevo) configured — set it up in Integrations."
                    : !bulk && !email.trim()
                      ? "Add an email address."
                      : (bulk ? "Sent to each candidate\u2019s email" : `To ${email.trim()}`)}
                </span>
              </span>
            </label>
          </div>
  );
}
