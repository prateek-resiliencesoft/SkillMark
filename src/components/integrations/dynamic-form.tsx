"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  isFileField,
  validateSubmission,
  type FieldError,
  type FormField,
  type UploadedFileInfo,
} from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

type Values = Record<string, unknown>;

function initialValues(fields: FormField[]): Values {
  const v: Values = {};
  for (const f of fields) {
    if (isFileField(f.type)) continue;
    if (f.defaultValue !== undefined) v[f.key] = f.defaultValue;
    else if (f.type === "multi_select") v[f.key] = [];
    else if (f.type === "checkbox" || f.type === "consent") v[f.key] = false;
    else v[f.key] = "";
  }
  return v;
}

export interface DynamicFormProps {
  fields: FormField[];
  /** preview mode: validates but never submits */
  preview?: boolean;
  submitLabel?: string;
  onSubmit?: (data: FormData) => Promise<{ errors?: FieldError[]; message?: string } | void>;
}

/** Candidate-facing renderer for a dynamic interview form (builder preview + hosted form). */
export function DynamicForm({ fields, preview, submitLabel = "Submit application", onSubmit }: DynamicFormProps) {
  const visible = useMemo(() => fields.filter((f) => !f.hidden), [fields]);
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewOk, setPreviewOk] = useState(false);

  const set = (k: string, v: unknown) => {
    setValues((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: "" }));
    setPreviewOk(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const answers: Values = {};
    for (const f of fields) if (!isFileField(f.type)) answers[f.key] = values[f.key] ?? (f.defaultValue as unknown);
    const infos: Record<string, UploadedFileInfo[]> = {};
    for (const [k, list] of Object.entries(files)) if (list.length) infos[k] = list.map((f) => ({ name: f.name, size: f.size, type: f.type }));
    const res = validateSubmission(fields, answers, infos);
    if (!res.ok) {
      const m: Record<string, string> = {};
      for (const er of res.errors) m[er.field] ??= er.message;
      setErrors(m);
      setFormError("Please fix the highlighted fields.");
      return;
    }
    setErrors({});
    if (preview || !onSubmit) {
      setPreviewOk(true);
      return;
    }
    const fd = new FormData();
    for (const [k, v] of Object.entries(res.values)) {
      if (Array.isArray(v)) v.forEach((item) => fd.append(`answers[${k}][]`, String(item)));
      else fd.append(`answers[${k}]`, String(v));
    }
    for (const [k, list] of Object.entries(files)) list.forEach((f) => fd.append(`files[${k}]`, f, f.name));
    fd.append("answers[_hp]", (document.getElementById("_hp_field") as HTMLInputElement | null)?.value ?? "");
    setBusy(true);
    try {
      const r = await onSubmit(fd);
      if (r?.errors?.length) {
        const m: Record<string, string> = {};
        for (const er of r.errors) m[er.field] ??= er.message;
        setErrors(m);
      }
      if (r?.message) setFormError(r.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <input id="_hp_field" name="_hp" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {visible.length === 0 && <p className="text-sm text-muted-foreground">No fields yet.</p>}
      {visible.map((f) => {
        const err = errors[f.key];
        const id = `fld_${f.key}`;
        const v = values[f.key];
        const label = (
          <Label htmlFor={id} className="text-sm font-medium">
            {f.label}
            {f.required && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
        );
        let control: React.ReactNode = null;
        switch (f.type) {
          case "long_text":
            control = <Textarea id={id} value={String(v ?? "")} placeholder={f.placeholder} maxLength={f.maxLength} onChange={(e) => set(f.key, e.target.value)} rows={4} />;
            break;
          case "dropdown":
            control = (
              <select id={id} className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">{f.placeholder || "Select…"}</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            );
            break;
          case "single_select":
            control = (
              <div className="flex flex-wrap gap-3">
                {(f.options ?? []).map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={id} checked={v === o} onChange={() => set(f.key, o)} /> {o}
                  </label>
                ))}
              </div>
            );
            break;
          case "multi_select": {
            const arr = Array.isArray(v) ? (v as string[]) : [];
            control = (
              <div className="flex flex-wrap gap-2">
                {(f.options ?? []).map((o) => {
                  const on = arr.includes(o);
                  return (
                    <button type="button" key={o} onClick={() => set(f.key, on ? arr.filter((x) => x !== o) : [...arr, o])}
                      className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                      {o}
                    </button>
                  );
                })}
              </div>
            );
            break;
          }
          case "checkbox":
          case "consent":
            control = (
              <label className="flex items-start gap-2 text-sm">
                <input id={id} type="checkbox" className="mt-0.5" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} />
                <span>{f.label}{f.required && <span className="ml-0.5 text-destructive">*</span>}</span>
              </label>
            );
            break;
          case "file":
          case "resume":
          case "cover_letter":
          case "document": {
            const accept = (f.allowedFileTypes ?? []).map((t) => `.${t.replace(/^\./, "")}`).join(",");
            const list = files[f.key] ?? [];
            control = (
              <div>
                <Input id={id} type="file" accept={accept || undefined} multiple={!!f.multiple}
                  onChange={(e) => { setFiles((p) => ({ ...p, [f.key]: Array.from(e.target.files ?? []) })); setErrors((p) => ({ ...p, [f.key]: "" })); setPreviewOk(false); }} />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {(f.allowedFileTypes ?? []).length ? `Allowed: ${(f.allowedFileTypes ?? []).join(", ").toUpperCase()} · ` : ""}Max {f.maxFileSizeMb ?? 10} MB{f.multiple ? " · multiple files allowed" : ""}
                  {list.length ? ` · ${list.map((x) => x.name).join(", ")}` : ""}
                </p>
              </div>
            );
            break;
          }
          default: {
            const type = f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "number" ? "number" : f.type === "url" ? "url" : f.type === "date" ? "date" : "text";
            control = <Input id={id} type={type} value={String(v ?? "")} placeholder={f.placeholder} min={f.min} max={f.max} maxLength={f.maxLength} onChange={(e) => set(f.key, e.target.value)} />;
          }
        }
        return (
          <div key={f.id} className="space-y-1.5">
            {f.type !== "checkbox" && f.type !== "consent" && label}
            {f.description && f.type !== "checkbox" && f.type !== "consent" && <p className="text-xs text-muted-foreground">{f.description}</p>}
            {control}
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
        );
      })}
      {formError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}
      {previewOk && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Preview: all fields are valid (nothing was submitted).</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {preview ? "Validate (preview)" : submitLabel}
      </Button>
    </form>
  );
}
