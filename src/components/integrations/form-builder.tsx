"use client";

import { DynamicForm } from "@/components/integrations/dynamic-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  defaultInterviewConfig,
  isFileField,
  isOptionField,
  newFieldId,
  slugKey,
  validateFieldDefinitions,
  type FieldType,
  type FormField,
  type FormSettings,
  type InterviewConfig,
} from "@/lib/forms/schema";
import { trpc } from "@/lib/trpc/client";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, KeyRound, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const sel = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-slate-100 text-slate-700",
  pending: "bg-amber-100 text-amber-800",
  scheduled: "bg-sky-100 text-sky-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-zinc-200 text-zinc-700",
  disqualified: "bg-red-100 text-red-700",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[status] ?? "bg-muted"}`}>{status.replace("_", " ")}</span>;
}

function FieldEditor({ field, onChange }: { field: FormField; onChange: (f: FormField) => void }) {
  const up = (p: Partial<FormField>) => onChange({ ...field, ...p });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Label</Label>
          <Input value={field.label} onChange={(e) => up({ label: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Unique key</Label>
          <Input value={field.key} onChange={(e) => up({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} className="font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <Label>Type</Label>
          <select className={sel} value={field.type} onChange={(e) => {
            const t = e.target.value as FieldType;
            up({ type: t, ...(isOptionField(t) && !field.options?.length ? { options: ["Option 1", "Option 2"] } : {}), ...(isFileField(t) && !field.allowedFileTypes ? { allowedFileTypes: ["pdf", "docx"], maxFileSizeMb: 10 } : {}) });
          }}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Placeholder</Label>
          <Input value={field.placeholder ?? ""} onChange={(e) => up({ placeholder: e.target.value || undefined })} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Description / help text</Label>
        <Input value={field.description ?? ""} onChange={(e) => up({ description: e.target.value || undefined })} />
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm"><Switch checked={field.required} onCheckedChange={(v) => up({ required: v })} /> Required</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={!!field.hidden} onCheckedChange={(v) => up({ hidden: v })} /> Hidden (uses default value)</label>
        {isFileField(field.type) && <label className="flex items-center gap-2 text-sm"><Switch checked={!!field.multiple} onCheckedChange={(v) => up({ multiple: v })} /> Multiple files</label>}
      </div>
      {["short_text", "long_text", "email", "phone", "url"].includes(field.type) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label>Min length</Label><Input type="number" value={field.minLength ?? ""} onChange={(e) => up({ minLength: num(e.target.value) })} /></div>
          <div className="space-y-1"><Label>Max length</Label><Input type="number" value={field.maxLength ?? ""} onChange={(e) => up({ maxLength: num(e.target.value) })} /></div>
          <div className="space-y-1"><Label>Regex pattern</Label><Input value={field.pattern ?? ""} onChange={(e) => up({ pattern: e.target.value || undefined })} className="font-mono text-xs" /></div>
        </div>
      )}
      {(field.type === "number" || field.type === "multi_select") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>{field.type === "number" ? "Min value" : "Min selections"}</Label><Input type="number" value={field.min ?? ""} onChange={(e) => up({ min: num(e.target.value) })} /></div>
          <div className="space-y-1"><Label>{field.type === "number" ? "Max value" : "Max selections"}</Label><Input type="number" value={field.max ?? ""} onChange={(e) => up({ max: num(e.target.value) })} /></div>
        </div>
      )}
      {isOptionField(field.type) && (
        <div className="space-y-1">
          <Label>Options (one per line)</Label>
          <Textarea rows={4} value={(field.options ?? []).join("\n")} onChange={(e) => up({ options: e.target.value.split("\n").map((s) => s.trimStart()).filter((s, i, a) => s !== "" || i === a.length - 1) })} />
        </div>
      )}
      {isFileField(field.type) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Allowed file types (comma separated)</Label><Input value={(field.allowedFileTypes ?? []).join(", ")} onChange={(e) => up({ allowedFileTypes: e.target.value.split(",").map((s) => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean) })} placeholder="pdf, docx" /></div>
          <div className="space-y-1"><Label>Max file size (MB, ≤ 20)</Label><Input type="number" value={field.maxFileSizeMb ?? ""} onChange={(e) => up({ maxFileSizeMb: num(e.target.value) })} /></div>
        </div>
      )}
      {!isFileField(field.type) && (
        <div className="space-y-1">
          <Label>Default value</Label>
          <Input value={Array.isArray(field.defaultValue) ? field.defaultValue.join(", ") : field.defaultValue === undefined ? "" : String(field.defaultValue)}
            onChange={(e) => {
              const s = e.target.value;
              if (s === "") return up({ defaultValue: undefined });
              if (field.type === "multi_select") return up({ defaultValue: s.split(",").map((x) => x.trim()).filter(Boolean) });
              if (field.type === "number") return up({ defaultValue: Number(s) });
              if (field.type === "checkbox" || field.type === "consent") return up({ defaultValue: s === "true" });
              up({ defaultValue: s });
            }} />
        </div>
      )}
    </div>
  );
}

export function FormBuilder({ formId }: { formId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();
  const q = trpc.interviewForm.get.useQuery({ id: formId });
  const apps = trpc.interviewForm.applications.useQuery({ id: formId }, { refetchInterval: 15000 });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [config, setConfig] = useState<InterviewConfig>(defaultInterviewConfig());
  const [settings, setSettings] = useState<FormSettings>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newType, setNewType] = useState<FieldType>("short_text");

  useEffect(() => {
    if (!q.data) return;
    setName(q.data.name);
    setDescription(q.data.description ?? "");
    setFields(q.data.fields ?? []);
    setConfig({ ...defaultInterviewConfig(), ...(q.data.config as unknown as InterviewConfig) });
    setSettings((q.data.settings as FormSettings) ?? {});
    setDirty(false);
  }, [q.data]);

  const onErr = (e: { message: string }) => toast({ title: "Error", description: e.message, variant: "destructive" });
  const update = trpc.interviewForm.update.useMutation({ onError: onErr });
  const publish = trpc.interviewForm.publish.useMutation({ onError: onErr });
  const unpublish = trpc.interviewForm.unpublish.useMutation({ onError: onErr });
  const duplicate = trpc.interviewForm.duplicate.useMutation({ onError: onErr });
  const sync = trpc.interviewForm.syncInterview.useMutation({ onError: onErr });

  const markDirty = () => setDirty(true);
  const setField = (id: string, f: FormField) => { setFields((p) => p.map((x) => (x.id === id ? f : x))); markDirty(); };
  const move = (i: number, d: -1 | 1) => {
    setFields((p) => { const a = [...p]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
    markDirty();
  };
  const addField = () => {
    const label = FIELD_TYPE_LABELS[newType];
    let key = slugKey(label);
    let n = 2;
    while (fields.some((f) => f.key === key)) key = `${slugKey(label)}_${n++}`;
    const f: FormField = {
      id: newFieldId(), key, type: newType, label, required: false,
      ...(isOptionField(newType) ? { options: ["Option 1", "Option 2"] } : {}),
      ...(isFileField(newType) ? { allowedFileTypes: ["pdf", "docx"], maxFileSizeMb: 10 } : {}),
    };
    setFields((p) => [...p, f]);
    setSelected(f.id);
    markDirty();
  };
  const setCfg = (p: Partial<InterviewConfig>) => { setConfig((c) => ({ ...c, ...p })); markDirty(); };

  const problems = validateFieldDefinitions(fields);

  const save = async () => {
    if (problems.length) { toast({ title: "Fix field problems first", description: problems[0], variant: "destructive" }); return false; }
    const cleanFields = fields.map((f) => ({ ...f, options: f.options?.map((o) => o.trim()).filter(Boolean) }));
    await update.mutateAsync({ id: formId, name, description: description || null, fields: cleanFields, config, settings });
    await utils.interviewForm.get.invalidate({ id: formId });
    toast({ title: "Saved" });
    return true;
  };

  if (q.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!q.data) return <p className="text-sm text-muted-foreground">Form not found.</p>;
  const form = q.data;
  const hostedUrl = `${form.baseUrl}/f/${form.publicId}`;
  const sel1 = fields.find((f) => f.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{name || "Untitled form"}</h1>
            <Badge variant={form.status === "published" ? "default" : "secondary"}>{form.status}</Badge>
            {dirty && <Badge variant="outline">unsaved</Badge>}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">interview_form_id: {form.publicId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={save} disabled={update.isLoading}>{update.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save draft</Button>
          {form.status === "published" ? (
            <Button variant="outline" onClick={async () => { await unpublish.mutateAsync({ id: formId }); utils.interviewForm.get.invalidate({ id: formId }); }}>Unpublish</Button>
          ) : (
            <Button onClick={async () => {
              if (dirty && !(await save())) return;
              await publish.mutateAsync({ id: formId });
              await utils.interviewForm.get.invalidate({ id: formId });
              toast({ title: "Published", description: "Integration docs are ready under My Integrations." });
            }} disabled={publish.isLoading}>{publish.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Publish</Button>
          )}
          <Button variant="ghost" asChild><Link href="/integrations/api-keys"><KeyRound className="mr-1.5 h-4 w-4" />Manage API keys</Link></Button>
          <Button variant="ghost" onClick={async () => { const d = await duplicate.mutateAsync({ id: formId }); router.push(`/integrations/forms/${d.id}`); }}><Copy className="mr-1.5 h-4 w-4" />Duplicate</Button>
          {form.status === "published" && (
            <>
              <Button variant="ghost" asChild><a href={hostedUrl} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" />Open hosted form</a></Button>
              <Button variant="ghost" asChild><Link href={`/integrations?form=${form.id}`}><ExternalLink className="mr-1.5 h-4 w-4" />API docs</Link></Button>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="fields">
        <TabsList>
          <TabsTrigger value="fields">Candidate form</TabsTrigger>
          <TabsTrigger value="interview">Interview configuration</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="submissions">Submissions ({apps.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="fields" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Fields</CardTitle><CardDescription>Add, edit, reorder and remove fields. Keys are used in the API (answers.&lt;key&gt; / files[&lt;key&gt;]).</CardDescription></CardHeader>
                <CardContent className="space-y-2">
                  {fields.map((f, i) => (
                    <div key={f.id} className={`rounded-md border ${selected === f.id ? "border-primary" : ""}`}>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button type="button" className="flex-1 text-left" onClick={() => setSelected(selected === f.id ? null : f.id)}>
                          <span className="text-sm font-medium">{f.label || f.key}</span>
                          {f.required && <span className="ml-1 text-destructive">*</span>}
                          <span className="ml-2 text-xs text-muted-foreground">{FIELD_TYPE_LABELS[f.type]} · <code>{f.key}</code>{f.hidden ? " · hidden" : ""}</span>
                        </button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { setFields((p) => p.filter((x) => x.id !== f.id)); markDirty(); }} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                      {selected === f.id && sel1 && <div className="border-t p-3"><FieldEditor field={sel1} onChange={(nf) => setField(f.id, nf)} /></div>}
                    </div>
                  ))}
                  <div className="flex gap-2 pt-2">
                    <select className={sel} value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>
                      {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
                    </select>
                    <Button onClick={addField}><Plus className="mr-1 h-4 w-4" />Add field</Button>
                  </div>
                  {problems.length > 0 && (
                    <ul className="mt-2 list-inside list-disc rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                      {problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
            <Card className="h-fit lg:sticky lg:top-4">
              <CardHeader className="pb-3"><CardTitle className="text-base">Live candidate preview</CardTitle><CardDescription>{config.title || name}</CardDescription></CardHeader>
              <CardContent>
                <DynamicForm key={JSON.stringify(fields)} fields={fields} preview />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="interview" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Interview configuration</CardTitle><CardDescription>Separate from the candidate form. Used to create the AI interview candidates take after applying.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1"><Label>Interview title *</Label><Input value={config.title} onChange={(e) => setCfg({ title: e.target.value })} /></div>
                <div className="space-y-1"><Label>Job role</Label><Input value={config.jobRole ?? ""} onChange={(e) => setCfg({ jobRole: e.target.value })} placeholder="Flutter Developer" /></div>
              </div>
              <div className="space-y-1"><Label>Description</Label><Textarea rows={2} value={config.description ?? ""} onChange={(e) => setCfg({ description: e.target.value })} /></div>
              <div className="space-y-1"><Label>Job description</Label><Textarea rows={4} value={config.jobDescription ?? ""} onChange={(e) => setCfg({ jobDescription: e.target.value })} /></div>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="space-y-1"><Label>Experience level</Label><select className={sel} value={config.experienceLevel} onChange={(e) => setCfg({ experienceLevel: e.target.value as InterviewConfig["experienceLevel"] })}>{["intern", "junior", "mid", "senior", "lead"].map((x) => <option key={x}>{x}</option>)}</select></div>
                <div className="space-y-1"><Label>Interview type</Label><select className={sel} value={config.interviewType} onChange={(e) => setCfg({ interviewType: e.target.value as InterviewConfig["interviewType"] })}>{["technical", "behavioral", "mixed", "screening"].map((x) => <option key={x}>{x}</option>)}</select></div>
                <div className="space-y-1"><Label>Difficulty</Label><select className={sel} value={config.difficulty} onChange={(e) => setCfg({ difficulty: e.target.value as InterviewConfig["difficulty"] })}>{["easy", "medium", "hard"].map((x) => <option key={x}>{x}</option>)}</select></div>
                <div className="space-y-1"><Label>Mode</Label><select className={sel} value={config.mode} onChange={(e) => setCfg({ mode: e.target.value as InterviewConfig["mode"] })}><option value="voice">voice</option><option value="chat">chat</option></select></div>
                <div className="space-y-1"><Label>Number of questions</Label><Input type="number" min={1} max={30} value={config.numberOfQuestions ?? ""} onChange={(e) => setCfg({ numberOfQuestions: num(e.target.value) })} /></div>
                <div className="space-y-1"><Label>Duration (minutes)</Label><Input type="number" min={5} max={180} value={config.durationMinutes ?? ""} onChange={(e) => setCfg({ durationMinutes: num(e.target.value) })} /></div>
                <div className="space-y-1"><Label>Language</Label><Input value={config.language ?? "en"} onChange={(e) => setCfg({ language: e.target.value })} /></div>
                <div className="space-y-1"><Label>Questions</Label><select className={sel} value={config.questionSource} onChange={(e) => setCfg({ questionSource: e.target.value as InterviewConfig["questionSource"] })}><option value="ai">AI-generated</option><option value="predefined">Predefined only</option></select></div>
              </div>
              <div className="space-y-1">
                <Label>Question categories</Label>
                <div className="flex flex-wrap gap-2">
                  {["technical", "behavioral", "situational", "culture fit", "problem solving", "system design"].map((c) => {
                    const on = config.categories?.includes(c);
                    return <button key={c} type="button" onClick={() => setCfg({ categories: on ? config.categories!.filter((x) => x !== c) : [...(config.categories ?? []), c] })} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-primary bg-primary text-primary-foreground" : ""}`}>{c}</button>;
                  })}
                  <Input className="h-7 w-48 text-xs" placeholder="custom category + Enter" onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === "Enter" && v) { e.preventDefault(); setCfg({ categories: [...(config.categories ?? []), v] }); (e.target as HTMLInputElement).value = ""; } }} />
                </div>
              </div>
              <div className="space-y-1"><Label>Predefined questions (one per line{config.questionSource === "ai" ? "; always included" : ""})</Label><Textarea rows={4} value={(config.predefinedQuestions ?? []).join("\n")} onChange={(e) => setCfg({ predefinedQuestions: e.target.value.split("\n") })} /></div>
              <div className="space-y-1"><Label>Evaluation criteria (one per line: name | weight | description)</Label>
                <Textarea rows={3} value={(config.evaluationCriteria ?? []).map((c) => [c.name, c.weight ?? "", c.description ?? ""].join(" | ")).join("\n")}
                  onChange={(e) => setCfg({ evaluationCriteria: e.target.value.split("\n").map((l) => { const [n, w, d] = l.split("|").map((s) => s.trim()); return { name: n ?? "", weight: w ? Number(w) || undefined : undefined, description: d || undefined }; }).filter((c) => c.name) })} />
              </div>
              <div className="space-y-1"><Label>Interview instructions</Label><Textarea rows={2} value={config.instructions ?? ""} onChange={(e) => setCfg({ instructions: e.target.value })} /></div>
              <div className="rounded-md border p-3 space-y-3">
                <label className="flex items-center justify-between gap-2 text-sm"><span>Anti-cheating mode (camera, mic & screen required; tab/paste/multi-screen tracking)</span><Switch checked={!!config.antiCheatingEnabled} onCheckedChange={(v) => setCfg({ antiCheatingEnabled: v })} /></label>
                {config.antiCheatingEnabled && <label className="flex items-center justify-between gap-2 text-sm"><span>Head movement detection (warn twice, disqualify on 3rd)</span><Switch checked={!!config.headMovementDetectionEnabled} onCheckedChange={(v) => setCfg({ headMovementDetectionEnabled: v })} /></label>}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <Button onClick={async () => { if (!(await save())) return; const r = await sync.mutateAsync({ id: formId, regenerate: !!form.interviewId }); toast({ title: "Interview ready", description: `${r.questionCount} questions` }); utils.interviewForm.get.invalidate({ id: formId }); }} disabled={sync.isLoading}>
                  {sync.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {form.interviewId ? "Save & regenerate questions" : "Save & create interview"}
                </Button>
                {form.interviewId && (
                  <>
                    <Button variant="outline" onClick={async () => { if (!(await save())) return; await sync.mutateAsync({ id: formId, regenerate: false }); toast({ title: "Interview settings updated" }); }}>Save settings only</Button>
                    <Link className="text-sm text-primary underline" href={`/interviews/${form.interviewId}/edit`}>Review questions in interview editor</Link>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1"><Label>Form name (internal)</Label><Input value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} /></div>
              <div className="space-y-1"><Label>Candidate-facing intro</Label><Textarea rows={2} value={description} onChange={(e) => { setDescription(e.target.value); markDirty(); }} /></div>
              <div className="space-y-1"><Label>Success message</Label><Input value={settings.successMessage ?? ""} onChange={(e) => { setSettings((s) => ({ ...s, successMessage: e.target.value })); markDirty(); }} /></div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={settings.redirectToInterview !== false} onCheckedChange={(v) => { setSettings((s) => ({ ...s, redirectToInterview: v })); markDirty(); }} /> Redirect candidate to the interview after submitting (hosted form)</label>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="submissions" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {!apps.data?.length ? <p className="text-sm text-muted-foreground">No submissions yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Candidate</th><th>Status</th><th>Source</th><th>Submitted</th><th></th></tr></thead>
                    <tbody>
                      {apps.data.map((a) => (
                        <tr key={a.id} className="border-t">
                          <td className="py-2"><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.email} · <code>{a.publicId}</code></div></td>
                          <td><StatusPill status={a.status} /></td>
                          <td className="text-xs">{a.source}{a.environment === "test" ? " (test)" : ""}</td>
                          <td className="text-xs">{new Date(a.createdAt).toLocaleString()}</td>
                          <td className="text-right text-xs">
                            {a.sessionId && form.interviewId ? <Link className="text-primary underline" href={`/interviews/${form.interviewId}/results?session=${a.sessionId}`}>Results</Link>
                              : a.interviewUrl ? <button className="text-primary underline" onClick={() => { navigator.clipboard.writeText(a.interviewUrl!); toast({ title: "Interview link copied" }); }}>Copy link</button> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
