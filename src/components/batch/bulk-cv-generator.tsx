"use client";

import { SendInvitesDialog } from "@/components/batch/send-invites-dialog";
import {
  CompletionNotifyPicker,
  readyCompletionNotifyMembers,
} from "@/components/interview/completion-notify-picker";
import {
  PremadeQuestionPicker,
  selectedPremadePayload,
} from "@/components/questions/premade-question-picker";
import { useOrg } from "@/components/org-provider";
import { useProject } from "@/components/project-provider";
import type { CompletionNotifyMember } from "@/lib/completion-notify";
import { parseCompletionNotifyMembers } from "@/lib/completion-notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  INTERVIEWER_GENDER_OPTIONS,
  normalizeInterviewerGender,
  type InterviewerGender,
} from "@/lib/interviewer-persona";
import { flattenEnabledBankList } from "@/lib/premade-sections";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileUp,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const INTERVIEW_TYPES = [
  { value: "technical", label: "Technical" },
  { value: "behavioral", label: "Behavioral" },
  { value: "mixed", label: "Mixed" },
  { value: "screening", label: "Screening" },
] as const;

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

export function BulkCvGenerator({
  projectId,
  existingBatchId,
  existingBatchName,
  compact,
  onFinished,
}: {
  projectId?: string;
  /** Add CVs into this batch instead of creating a new one. */
  existingBatchId?: string;
  existingBatchName?: string;
  /** Hide the shared batch-settings card (for add-to-existing dialogs). */
  compact?: boolean;
  onFinished?: (batchId: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const { currentProject } = useProject();
  const bankOrgId = currentProject?.organizationId || currentOrg?.id || "";
  const fileInput = useRef<HTMLInputElement>(null);
  const appendMode = !!existingBatchId;

  const [batchName, setBatchName] = useState(
    () =>
      existingBatchName ??
      `Batch ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`,
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
  const [aiGender, setAiGender] = useState<InterviewerGender>(
    normalizeInterviewerGender(currentOrg?.defaultInterviewerGender),
  );
  const [followUpDepth, setFollowUpDepth] = useState<"LIGHT" | "MODERATE" | "DEEP">("MODERATE");
  const [antiCheatingEnabled, setAntiCheatingEnabled] = useState(false);
  const [headMovementDetectionEnabled, setHeadMovementDetectionEnabled] = useState(false);
  const [interviewType, setInterviewType] = useState<"technical" | "behavioral" | "mixed" | "screening">("mixed");
  const [includePremade, setIncludePremade] = useState(true);
  const [selectedPremadeIds, setSelectedPremadeIds] = useState<Set<string>>(new Set());
  const [notifyMembers, setNotifyMembers] = useState<CompletionNotifyMember[]>([]);

  const [rows, setRows] = useState<CvRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(existingBatchId ?? null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (existingBatchId) setBatchId(existingBatchId);
  }, [existingBatchId]);

  const existingBatch = trpc.batch.getById.useQuery(
    { id: existingBatchId ?? "" },
    { enabled: !!existingBatchId },
  );
  useEffect(() => {
    const t = existingBatch.data?.settings?.interviewType;
    if (t === "technical" || t === "behavioral" || t === "mixed" || t === "screening") {
      setInterviewType(t);
    }
  }, [existingBatch.data?.settings?.interviewType]);

  useEffect(() => {
    const members = existingBatch.data?.settings?.completionNotifyMembers;
    if (members) setNotifyMembers(parseCompletionNotifyMembers(members));
  }, [existingBatch.data?.settings?.completionNotifyMembers]);

  const [sendOpen, setSendOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const previewRow = previewKey ? rows.find((r) => r.key === previewKey) ?? null : null;

  const bankListQuery = trpc.questionBank.list.useQuery(
    { organizationId: bankOrgId },
    { enabled: !!bankOrgId, staleTime: 10_000, refetchOnMount: "always" },
  );
  const premadeQuestionsList = useMemo(
    () => flattenEnabledBankList(bankListQuery.data).questions,
    [bankListQuery.data],
  );

  const createBatch = trpc.batch.create.useMutation();
  const updateBatchSettings = trpc.batch.updateSettings.useMutation();
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
        if (currentOrg?.id) form.append("organizationId", currentOrg.id);
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
    [countryCode, currentOrg?.id, patchRow],
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
    // Prefer picker selection; if include is on but seed race left ids empty,
    // fall back to ALL enabled bank questions so Screening Auto-include still applies.
    let premadeQuestions = selectedPremadePayload(
      premadeQuestionsList,
      selectedPremadeIds,
      includePremade,
    );
    if (
      includePremade &&
      !premadeQuestions?.length &&
      premadeQuestionsList.length > 0
    ) {
      premadeQuestions = selectedPremadePayload(
        premadeQuestionsList,
        new Set(premadeQuestionsList.map((q) => q.id)),
        true,
      );
    }

    // Existing batch: refresh premade list so newly picked Qs apply to new candidates
    if (existingBatchId || batchId) {
      const id = existingBatchId ?? batchId!;
      try {
        await updateBatchSettings.mutateAsync({
          batchId: id,
          ...(premadeQuestions ? { premadeQuestions } : {}),
          completionNotifyMembers: readyCompletionNotifyMembers(notifyMembers),
        });
      } catch {
        /* non-fatal — still generate with stored settings / server bank fallback */
      }
      return id;
    }

    const batch = await createBatch.mutateAsync({
      projectId,
      name: batchName.trim(),
      settings: {
        roleDescription: roleDescription.trim(),
        jobDescription: jobDescription.trim() || undefined,
        durationMinutes: Number(duration) || 20,
        language,
        interviewType,
        chatEnabled,
        voiceEnabled,
        videoEnabled,
        aiTone,
        aiGender,
        followUpDepth,
        antiCheatingEnabled,
        headMovementDetectionEnabled: antiCheatingEnabled && headMovementDetectionEnabled,
        defaultCountryCode: countryCode || undefined,
        premadeQuestions,
        completionNotifyMembers: readyCompletionNotifyMembers(notifyMembers),
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
          // Persist original CV so sessions screen can open it later
          try {
            const fd = new FormData();
            fd.append("file", row.file);
            fd.append("candidateId", r.candidateId);
            await fetch("/api/batches/upload-cv", { method: "POST", body: fd });
          } catch {
            /* non-fatal — resumeMarkdown still on profile */
          }
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
  const canGenerate =
    readyValid.length > 0 &&
    !running &&
    (appendMode || (!!batchName.trim() && !!roleDescription.trim()));

  return (
    <div className="space-y-6">
      {appendMode && (
        <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
          Adding candidates to{" "}
          <span className="font-medium text-foreground">
            {existingBatchName ?? "this batch"}
          </span>
          . New interviews use the batch&apos;s existing role settings.
        </div>
      )}

      {!compact && (
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
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SettingSelect
              label="Interview type"
              value={interviewType}
              onChange={(v) => setInterviewType(v as typeof interviewType)}
              options={INTERVIEW_TYPES}
              disabled={!!batchId}
            />
            <SettingSelect
              label="Interviewer gender"
              value={aiGender}
              onChange={(v) => setAiGender(v as InterviewerGender)}
              options={INTERVIEWER_GENDER_OPTIONS.map((g) => ({ value: g.value, label: g.label }))}
              disabled={!!batchId}
            />
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

          <PremadeQuestionPicker
            organizationId={bankOrgId}
            interviewType={interviewType}
            includePremade={includePremade}
            onIncludeChange={setIncludePremade}
            selectedIds={selectedPremadeIds}
            onSelectedChange={setSelectedPremadeIds}
            disabled={!!batchId && !appendMode}
          />

          <CompletionNotifyPicker
            organizationId={bankOrgId}
            value={notifyMembers}
            onChange={setNotifyMembers}
            disabled={!!batchId && !appendMode}
          />
        </CardContent>
      </Card>
      )}

      {appendMode && compact && (
        <PremadeQuestionPicker
          organizationId={bankOrgId}
          interviewType={interviewType}
          includePremade={includePremade}
          onIncludeChange={setIncludePremade}
          selectedIds={selectedPremadeIds}
          onSelectedChange={setSelectedPremadeIds}
          compact
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{compact ? "1. Upload CVs" : "2. Upload CVs"}</CardTitle>
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
                          <div className="flex items-center gap-0.5">
                            <Button size="icon" variant="ghost" title="View CV" onClick={() => setPreviewKey(r.key)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            {r.status === "parse_error" ? (
                              <Button size="icon" variant="ghost" title="Retry" onClick={() => void parseRow(r)}>
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            ) : r.status !== "generated" && r.status !== "generating" ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Remove"
                                onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
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
          <CardTitle>{compact ? "2. Generate" : "3. Generate & send"}</CardTitle>
          <CardDescription>
            Every candidate gets a unique private link that opens only their interview — no username or password to manage.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button disabled={!canGenerate} onClick={() => void generateRows(readyValid)}>
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {appendMode
              ? `Add ${readyValid.length} candidate${readyValid.length === 1 ? "" : "s"}`
              : batchId
                ? `Generate ${readyValid.length} more`
                : `Create batch & generate ${readyValid.length} interview${readyValid.length === 1 ? "" : "s"}`}
          </Button>
          {parsingCount > 0 && <span className="text-sm text-muted-foreground">Reading {parsingCount} CV(s)…</span>}
          {ready.length > readyValid.length && (
            <span className="text-sm text-amber-600">{ready.length - readyValid.length} row(s) need fixes first</span>
          )}

          {batchId && generated.length > 0 && !running && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t pt-4">
              <span className="mr-auto text-sm">
                <CheckCircle2 className="mr-1 inline h-4 w-4 text-green-600" />
                {generated.length} interview{generated.length === 1 ? "" : "s"} ready
                {appendMode ? "." : ". Send links now?"}
              </span>
              {appendMode ? (
                <Button
                  onClick={() => {
                    if (onFinished) onFinished(batchId);
                    else router.push(`/batches/${batchId}`);
                  }}
                >
                  Done
                </Button>
              ) : (
                <>
                  <Button onClick={() => setSendOpen(true)}>Send to all {generated.length}</Button>
                  <Button variant="outline" onClick={() => router.push(`/batches/${batchId}`)}>
                    Send one by one
                  </Button>
                  <Button variant="ghost" onClick={() => router.push(`/batches/${batchId}`)}>
                    Don&apos;t send now
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CvPreviewDialog row={previewRow} open={!!previewRow} onOpenChange={(o) => !o && setPreviewKey(null)} />

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

function CvPreviewDialog({
  row,
  open,
  onOpenChange,
}: {
  row: CvRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const file = row?.file ?? null;
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  if (!row) return null;

  const mime = row.file.type || "";
  const name = row.file.name.toLowerCase();
  const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
  const isImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name);
  const isText = mime.startsWith("text/") || /\.(txt|md)$/.test(name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4">
          <DialogTitle className="truncate pr-8">{row.name || row.file.name}</DialogTitle>
          <DialogDescription className="truncate">
            {row.file.name}
            {row.extractionMethod ? ` · extracted via ${row.extractionMethod}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {fileUrl && isPdf && (
            <iframe title={row.file.name} src={fileUrl} className="h-[55vh] w-full rounded-md border bg-muted/30" />
          )}
          {fileUrl && isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={row.file.name} className="mx-auto max-h-[55vh] rounded-md border object-contain" />
          )}
          {!isPdf && !isImage && (
            <p className="text-sm text-muted-foreground">
              Browser can&apos;t preview this file type inline. Download the original or read the extracted text below.
            </p>
          )}

          {row.markdown ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Extracted text</p>
              <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
                {row.markdown}
              </pre>
            </div>
          ) : isText && fileUrl ? (
            <iframe title="text preview" src={fileUrl} className="h-[40vh] w-full rounded-md border bg-muted/30" />
          ) : (
            <p className="text-xs text-muted-foreground">No extracted text yet (parse still running or failed).</p>
          )}

          {row.reviewFlags.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
              <p className="font-medium text-amber-900 dark:text-amber-200">Needs review</p>
              <ul className="space-y-1 text-amber-800 dark:text-amber-300">
                {row.reviewFlags.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium">{f.field}:</span> {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-3">
          {fileUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={fileUrl} download={row.file.name}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download original
              </a>
            </Button>
          )}
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
