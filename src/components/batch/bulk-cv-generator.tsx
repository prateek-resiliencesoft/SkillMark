"use client";

import { SendInvitesDialog } from "@/components/batch/send-invites-dialog";
import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { CandidateProfile, ReviewFlag } from "@/lib/documents/cv-profile";
import { AI_TONES, FOLLOW_UP_DEPTHS, LANGUAGES } from "@/lib/constants";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Layers,
  Loader2,
  MessageSquare,
  Mic,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Trash2,
  Video,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

type RowStatus = "queued" | "parsing" | "parsed" | "parse_error" | "generating" | "generated" | "generate_error";

interface CvRow {
  key: string;
  file: File;
  status: RowStatus;
  error?: string;
  name: string;
  email: string;
  phone: string;
  profile?: CandidateProfile;
  reviewFlags: ReviewFlag[];
  markdown?: string;
  extractionMethod?: string;
  candidateId?: string;
  interviewId?: string;
  questionCount?: number;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";
const MAX_FILES = 200;
const PARSE_CONCURRENCY = 3;
const GENERATE_CONCURRENCY = 2;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

const STATUS_LABEL: Record<RowStatus, string> = {
  queued: "Queued",
  parsing: "Reading CV…",
  parsed: "Ready",
  parse_error: "Couldn't read",
  generating: "Generating…",
  generated: "Interview ready",
  generate_error: "Generation failed",
};

export function BulkCvGenerator({ projectId }: { projectId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const fileInput = useRef<HTMLInputElement>(null);

  const [batchName, setBatchName] = useState(
    () => `Batch ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`,
  );
  const [roleDescription, setRoleDescription] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [duration, setDuration] = useState("20");
  const [language, setLanguage] = useState("en");
  const [countryCode, setCountryCode] = useState("");
  const [chatEnabled, setChatEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [aiTone, setAiTone] = useState<"CASUAL" | "PROFESSIONAL" | "FORMAL" | "FRIENDLY">("FRIENDLY");
  const [followUpDepth, setFollowUpDepth] = useState<"LIGHT" | "MODERATE" | "DEEP">("MODERATE");
  const [antiCheatingEnabled, setAntiCheatingEnabled] = useState(false);
  const [headMovementDetectionEnabled, setHeadMovementDetectionEnabled] = useState(false);
  const [includePremade, setIncludePremade] = useState(true);

  const [rows, setRows] = useState<CvRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const premade = trpc.questionBank.getEnabledQuestions.useQuery(
    { organizationId: currentOrg?.id ?? "" },
    { enabled: !!currentOrg?.id, staleTime: 30_000 },
  );
  const createBatch = trpc.batch.create.useMutation();
  const generateCandidate = trpc.batch.generateCandidate.useMutation();

  const patchRow = useCallback((key: string, patch: Partial<CvRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const parseRow = useCallback(
    async (row: CvRow) => {
      patchRow(row.key, { status: "parsing", error: undefined });
      try {
        const form = new FormData();
        form.append("file", row.file);
        if (countryCode) form.append("defaultCountryCode", countryCode);
        const res = await fetch("/api/batches/parse-cv", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        const p = json.profile as CandidateProfile;
        patchRow(row.key, {
          status: "parsed",
          profile: p,
          reviewFlags: json.reviewFlags ?? [],
          markdown: json.markdown,
          extractionMethod: json.extraction?.method,
          name: p.name ?? "",
          email: p.email ?? "",
          phone: p.phone ?? "",
        });
      } catch (err) {
        patchRow(row.key, { status: "parse_error", error: err instanceof Error ? err.message : "Failed" });
      }
    },
    [countryCode, patchRow],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files).slice(0, MAX_FILES - rows.length);
      if (!list.length) return;
      const newRows: CvRow[] = list.map((file) => ({
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: "queued",
        name: "",
        email: "",
        phone: "",
        reviewFlags: [],
      }));
      setRows((prev) => [...prev, ...newRows]);
      void runPool(newRows, PARSE_CONCURRENCY, parseRow);
    },
    [parseRow, rows.length],
  );

  const ensureBatch = async (): Promise<string> => {
    if (batchId) return batchId;
    const premadeQuestions = includePremade
      ? (premade.data?.questions ?? []).map((q) => ({
          text: q.text as string,
          type: (q.type as string) ?? undefined,
          sectionName: q.sectionName as string,
          description: (q.description as string | null) ?? undefined,
          options: q.options ?? undefined,
          starterCode: q.starterCode ?? undefined,
        }))
      : undefined;
    const batch = await createBatch.mutateAsync({
      projectId,
      name: batchName.trim(),
      settings: {
        roleDescription: roleDescription.trim(),
        jobDescription: jobDescription.trim() || undefined,
        durationMinutes: Number(duration) || 20,
        language,
        chatEnabled,
        voiceEnabled,
        videoEnabled,
        aiTone,
        followUpDepth,
        antiCheatingEnabled,
        headMovementDetectionEnabled: antiCheatingEnabled && headMovementDetectionEnabled,
        defaultCountryCode: countryCode || undefined,
        premadeQuestions,
      },
    });
    setBatchId(batch.id);
    return batch.id;
  };

  const generateRows = async (targets: CvRow[]) => {
    if (!targets.length) return;
    setRunning(true);
    try {
      const id = await ensureBatch();
      await runPool(targets, GENERATE_CONCURRENCY, async (row) => {
        patchRow(row.key, { status: "generating", error: undefined });
        try {
          const r = await generateCandidate.mutateAsync({
            batchId: id,
            fileName: row.file.name,
            extractionMethod: row.extractionMethod ?? "unknown",
            resumeMarkdown: row.markdown ?? "",
            profile: row.profile!,
            reviewFlags: row.reviewFlags,
            contact: {
              name: row.name.trim(),
              email: row.email.trim() || null,
              phone: row.phone.trim() || null,
            },
          });
          patchRow(row.key, {
            status: "generated",
            candidateId: r.candidateId,
            interviewId: r.interviewId,
            questionCount: r.questionCount,
          });
        } catch (err) {
          patchRow(row.key, { status: "generate_error", error: err instanceof Error ? err.message : "Failed" });
        }
      });
    } catch (err) {
      toast({ title: "Could not create batch", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const rowProblem = (r: CvRow): string | null => {
    if (!r.name.trim()) return "Name is required";
    if (r.email && !EMAIL_RE.test(r.email.trim())) return "Invalid email";
    if (!r.email.trim() && !r.phone.trim()) return "Add an email or phone to send the link";
    return null;
  };

  const ready = rows.filter((r) => r.status === "parsed" || r.status === "generate_error");
  const readyValid = ready.filter((r) => !rowProblem(r));
  const generated = rows.filter((r) => r.status === "generated");
  const parsingCount = rows.filter((r) => r.status === "queued" || r.status === "parsing").length;
  const canGenerate = !!batchName.trim() && !!roleDescription.trim() && readyValid.length > 0 && !running;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Batch & role</CardTitle>
          <CardDescription>
            Shared settings for every candidate. Each CV gets its own interview tailored to the candidate&apos;s tech stack,
            experience and projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batch-name">Batch name</Label>
              <Input id="batch-name" value={batchName} onChange={(e) => setBatchName(e.target.value)} disabled={!!batchId} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="batch-duration">Duration (min)</Label>
                <Input id="batch-duration" type="number" min={5} max={120} value={duration} onChange={(e) => setDuration(e.target.value)} disabled={!!batchId} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-cc">Default country code</Label>
                <Input
                  id="batch-cc"
                  placeholder="e.g. 91"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  disabled={rows.length > 0}
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="batch-role">Role & what to assess</Label>
            <Textarea
              id="batch-role"
              rows={3}
              placeholder="e.g. Full-stack developer (React + Node). 8 questions mixing open-ended, coding and one whiteboard; focus on depth in their own projects and system design."
              value={roleDescription}
              onChange={(e) => setRoleDescription(e.target.value)}
              disabled={!!batchId}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="batch-jd">Job description (optional)</Label>
            <Textarea
              id="batch-jd"
              rows={3}
              placeholder="Paste the JD to align every interview with the role requirements."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              disabled={!!batchId}
            />
          </div>

          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <ToggleRow icon={MessageSquare} label="Chat" checked={chatEnabled} disabled={!!batchId} onChange={(v) => (v || voiceEnabled) && setChatEnabled(v)} />
            <ToggleRow
              icon={Mic}
              label="Voice"
              checked={voiceEnabled}
              disabled={!!batchId}
              onChange={(v) => {
                if (!v && !chatEnabled) return;
                setVoiceEnabled(v);
                if (!v) setVideoEnabled(false);
              }}
            />
            <ToggleRow icon={Video} label="Video" checked={videoEnabled} disabled={!!batchId || !voiceEnabled} onChange={setVideoEnabled} />
            <ToggleRow icon={ShieldCheck} label="Anti-cheating" checked={antiCheatingEnabled} disabled={!!batchId} onChange={setAntiCheatingEnabled} />
            <ToggleRow
              icon={ScanFace}
              label="Head movement"
              checked={antiCheatingEnabled && headMovementDetectionEnabled}
              disabled={!!batchId || !antiCheatingEnabled}
              onChange={setHeadMovementDetectionEnabled}
            />
            <ToggleRow
              icon={Layers}
              label={`Premade bank${premade.data?.questions.length ? ` (${premade.data.questions.length})` : ""}`}
              checked={includePremade}
              disabled={!!batchId}
              onChange={setIncludePremade}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <SettingSelect label="Tone" value={aiTone} onChange={(v) => setAiTone(v as typeof aiTone)} options={AI_TONES} disabled={!!batchId} />
            <SettingSelect
              label="Follow-up depth"
              value={followUpDepth}
              onChange={(v) => setFollowUpDepth(v as typeof followUpDepth)}
              options={FOLLOW_UP_DEPTHS}
              disabled={!!batchId}
            />
            <SettingSelect label="Language" value={language} onChange={setLanguage} options={LANGUAGES} disabled={!!batchId} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload CVs</CardTitle>
          <CardDescription>
            PDF, DOCX, scanned PDFs and photos. Fields we can&apos;t read reliably are left blank and flagged — check them
            before generating.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm text-muted-foreground transition-colors",
              dragging ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/40",
            )}
          >
            <FileUp className="h-6 w-6" />
            <span>
              <span className="font-medium text-foreground">Drop CVs here</span> or click to choose (up to {MAX_FILES})
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">Name</TableHead>
                    <TableHead className="min-w-[200px]">Email</TableHead>
                    <TableHead className="min-w-[150px]">Phone</TableHead>
                    <TableHead className="min-w-[200px]">Tech stack</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const editable = r.status === "parsed" || r.status === "generate_error";
                    const problem = editable ? rowProblem(r) : null;
                    return (
                      <TableRow key={r.key}>
                        <TableCell>
                          {editable ? (
                            <Input className="h-8" value={r.name} placeholder="Full name" onChange={(e) => patchRow(r.key, { name: e.target.value })} />
                          ) : (
                            <span className="font-medium">{r.name || "—"}</span>
                          )}
                          <p className="mt-1 truncate text-xs text-muted-foreground" title={r.file.name}>
                            {r.file.name}
                          </p>
                        </TableCell>
                        <TableCell>
                          {editable ? (
                            <Input className="h-8" value={r.email} placeholder="email@example.com" onChange={(e) => patchRow(r.key, { email: e.target.value })} />
                          ) : (
                            <span className="text-sm">{r.email || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editable ? (
                            <Input className="h-8" value={r.phone} placeholder="+91…" onChange={(e) => patchRow(r.key, { phone: e.target.value.replace(/[^\d+]/g, "") })} />
                          ) : (
                            <span className="text-sm">{r.phone || "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(r.profile?.techStack ?? []).slice(0, 5).map((t) => (
                              <Badge key={t} variant="secondary" className="font-normal">
                                {t}
                              </Badge>
                            ))}
                            {(r.profile?.techStack.length ?? 0) > 5 && (
                              <span className="text-xs text-muted-foreground">+{r.profile!.techStack.length - 5}</span>
                            )}
                          </div>
                          {r.profile?.totalExperienceYears != null && (
                            <p className="mt-1 text-xs text-muted-foreground">{r.profile.totalExperienceYears} yrs exp</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 whitespace-nowrap text-sm">
                            <StatusIcon status={r.status} />
                            <span>{r.status === "generated" ? `${r.questionCount} questions` : STATUS_LABEL[r.status]}</span>
                            {r.reviewFlags.length > 0 && <FlagsPopover flags={r.reviewFlags} />}
                          </div>
                          {(r.error || problem) && (
                            <p className="mt-1 max-w-[220px] text-xs text-destructive">{r.error ?? problem}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.status === "parse_error" ? (
                            <Button size="icon" variant="ghost" title="Retry" onClick={() => void parseRow(r)}>
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          ) : r.status !== "generated" && r.status !== "generating" ? (
                            <Button size="icon" variant="ghost" title="Remove" onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Generate & send</CardTitle>
          <CardDescription>
            Every candidate gets a unique private link that opens only their interview — no username or password to manage.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button disabled={!canGenerate} onClick={() => void generateRows(readyValid)}>
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {batchId ? `Generate ${readyValid.length} more` : `Create batch & generate ${readyValid.length} interview${readyValid.length === 1 ? "" : "s"}`}
          </Button>
          {parsingCount > 0 && <span className="text-sm text-muted-foreground">Reading {parsingCount} CV(s)…</span>}
          {ready.length > readyValid.length && (
            <span className="text-sm text-amber-600">{ready.length - readyValid.length} row(s) need fixes first</span>
          )}

          {batchId && generated.length > 0 && !running && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t pt-4">
              <span className="mr-auto text-sm">
                <CheckCircle2 className="mr-1 inline h-4 w-4 text-green-600" />
                {generated.length} interview{generated.length === 1 ? "" : "s"} ready. Send links now?
              </span>
              <Button onClick={() => setSendOpen(true)}>Send to all {generated.length}</Button>
              <Button variant="outline" onClick={() => router.push(`/batches/${batchId}`)}>
                Send one by one
              </Button>
              <Button variant="ghost" onClick={() => router.push(`/batches/${batchId}`)}>
                Don&apos;t send now
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {batchId && (
        <SendInvitesDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          batchId={batchId}
          organizationId={currentOrg?.id}
          recipients={generated.map((r) => ({
            id: r.candidateId!,
            name: r.name,
            email: r.email || null,
            phone: r.phone || null,
          }))}
          onSent={() => router.push(`/batches/${batchId}`)}
        />
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "parsing" || status === "generating") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "generated") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "parse_error" || status === "generate_error") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "parsed") return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
  return <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

export function FlagsPopover({ flags }: { flags: ReviewFlag[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" />
          {flags.length}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <p className="mb-2 font-medium">Needs review</p>
        <ul className="space-y-1.5">
          {flags.map((f, i) => (
            <li key={i} className="text-muted-foreground">
              <span className="font-medium text-foreground">{f.field}:</span> {f.reason}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function SettingSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
