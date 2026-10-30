"use client";

import { useOrg } from "@/components/org-provider";
import { AiButton } from "@/components/ui/ai-button";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
    AlertCircle,
    CheckCircle2,
    FileText,
    Loader2,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    RotateCcw,
    Search,
    Trash2,
    Upload,
    Users,
    X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    CandidateFormFields,
    completionPercent,
    formToCandidateInput,
    initials,
    parsedToForm,
    parseResumeFile,
    SendLinkOptions,
    SkillChips,
    TailorToggle,
    validateCandidateForm,
    type CandidateFormState,
} from "./candidate-form";

interface ResumeImportDialogProps {
  interviewId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  /** Bulk upload: drag & drop many PDFs, parallel parsing, retry. */
  bulk?: boolean;
}

interface ResumeEntry {
  key: string;
  file: File;
  status: "pending" | "parsing" | "done" | "error";
  form: CandidateFormState | null;
  errorMsg?: string;
  streamText?: string;
}

type Step = "upload" | "preview" | "complete";

interface ImportSummary {
  created: number;
  total: number;
  delivery?: { email: { sent: number; failed: number }; whatsapp: { sent: number; failed: number }; errors: string[] };
}

let keySeq = 0;

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const palette = [
    "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  ];
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        palette[idx],
        size === "lg" ? "h-12 w-12 text-base" : "h-8 w-8 text-xs",
      )}
    >
      {initials(name)}
    </span>
  );
}

function StatusBadge({ status }: { status: "ready" | "fix" | "failed" }) {
  const map = {
    ready: { label: "Ready", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
    fix: { label: "Needs fixing", cls: "bg-destructive/10 text-destructive border-destructive/20" },
    failed: { label: "Failed", cls: "bg-muted text-muted-foreground border-border" },
  }[status];
  return (
    <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium", map.cls)}>{map.label}</span>
  );
}

export function ResumeImportDialog({
  interviewId,
  open,
  onOpenChange,
  onImported,
  bulk = false,
}: ResumeImportDialogProps) {
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<ResumeEntry[]>([]);
  const [step, setStep] = useState<Step>("upload");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const abortRef = useRef(false);
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const deliveryOptions = trpc.candidate.deliveryOptions.useQuery({ interviewId }, { enabled: open });
  const [sendEmail, setSendEmail] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  useEffect(() => {
    if (deliveryOptions.data) {
      setSendEmail(deliveryOptions.data.email);
      setSendWhatsapp(deliveryOptions.data.whatsapp);
    }
  }, [deliveryOptions.data]);

  const patchEntry = useCallback((key: string, patch: Partial<ResumeEntry>) => {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }, []);

  const bulkCreate = trpc.candidate.bulkCreate.useMutation({
    onSuccess: (data) => {
      setSummary(data);
      setStep("complete");
      onImported();
      const d = data.delivery;
      if (d && d.email.sent + d.email.failed + d.whatsapp.sent + d.whatsapp.failed > 0) {
        const failed = d.email.failed + d.whatsapp.failed;
        toast({
          title: failed ? "Imported — some invites not sent" : "Imported — invites sent",
          description: [
            d.whatsapp.sent + d.whatsapp.failed ? `WhatsApp: ${d.whatsapp.sent} sent, ${d.whatsapp.failed} failed` : "",
            d.email.sent + d.email.failed ? `Email: ${d.email.sent} sent, ${d.email.failed} failed` : "",
            ...d.errors,
          ]
            .filter(Boolean)
            .join(" · "),
          variant: failed ? "destructive" : undefined,
        });
      }
    },
    onError: (err) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const addFiles = useCallback((files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length < Array.from(files).length) {
      toast({ title: "Only PDF files are supported", description: "Non-PDF files were skipped." });
    }
    if (!pdfs.length) return;
    setEntries((prev) => [
      ...prev,
      ...pdfs.map((file) => ({ key: `r${++keySeq}`, file, status: "pending" as const, form: null })),
    ]);
  }, [toast]);

  const parseEntry = useCallback(
    async (entry: ResumeEntry) => {
      patchEntry(entry.key, { status: "parsing", streamText: "", errorMsg: undefined });
      try {
        const parsed = await parseResumeFile(entry.file, {
          organizationId: currentOrg?.id,
          interviewId,
          onStream: (text) => patchEntry(entry.key, { streamText: text }),
        });
        patchEntry(entry.key, { status: "done", form: parsedToForm(parsed), streamText: undefined });
        return true;
      } catch (err) {
        patchEntry(entry.key, {
          status: "error",
          errorMsg: err instanceof Error ? err.message : "Parse failed",
          streamText: undefined,
        });
        return false;
      }
    },
    [patchEntry, currentOrg?.id, interviewId],
  );

  const handleStartParsing = useCallback(
    async (only?: ResumeEntry[]) => {
      setIsParsing(true);
      abortRef.current = false;
      const queue = (only ?? entries).filter((e) => e.status !== "done");
      const concurrency = bulk ? 3 : 1;
      const worker = async () => {
        for (let e = queue.shift(); e && !abortRef.current; e = queue.shift()) await parseEntry(e);
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
      setIsParsing(false);
    },
    [entries, bulk, parseEntry],
  );

  const doneEntries = entries.filter((e) => e.status === "done" && e.form);
  const pendingOrParsing = entries.filter((e) => e.status === "pending" || e.status === "parsing");
  const errorEntries = entries.filter((e) => e.status === "error");
  const allDone = entries.length > 0 && pendingOrParsing.length === 0;
  const parsedCount = entries.length - pendingOrParsing.length;

  // Auto-advance to review once parsing finishes (only for the non-bulk single flow without failures)
  useEffect(() => {
    if (!isParsing && step === "upload" && allDone && doneEntries.length > 0 && errorEntries.length === 0 && !bulk) {
      setStep("preview");
    }
  }, [isParsing, step, allDone, doneEntries.length, errorEntries.length, bulk]);

  useEffect(() => {
    if (step === "preview" && (!selectedKey || !doneEntries.some((e) => e.key === selectedKey))) {
      setSelectedKey(doneEntries[0]?.key ?? null);
    }
  }, [step, selectedKey, doneEntries]);

  const errorsFor = (e: ResumeEntry) => (e.form ? validateCandidateForm(e.form) : { name: "Not parsed" });
  const invalidCount = doneEntries.filter((e) => Object.keys(errorsFor(e)).length > 0).length;
  const validCount = doneEntries.length - invalidCount;

  const handleImport = useCallback(() => {
    if (!doneEntries.length || invalidCount > 0) return;
    bulkCreate.mutate({
      interviewId,
      candidates: doneEntries.map((e) => {
        const c = formToCandidateInput(e.form!);
        return { ...c, email: c.email ?? "" };
      }),
      sendVia: {
        email: sendEmail && !!deliveryOptions.data?.email,
        whatsapp: sendWhatsapp && !!deliveryOptions.data?.whatsapp,
      },
    });
  }, [doneEntries, invalidCount, interviewId, bulkCreate, sendEmail, sendWhatsapp, deliveryOptions.data]);

  const handleClose = useCallback(() => {
    abortRef.current = true;
    setEntries([]);
    setStep("upload");
    setSummary(null);
    setSelectedKey(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onOpenChange(false);
  }, [onOpenChange]);

  const stepIndex = step === "upload" ? 0 : step === "preview" ? 1 : 2;
  const selected = doneEntries.find((e) => e.key === selectedKey) ?? doneEntries[0];
  const multi = doneEntries.length > 1;
  const selIdx = selected ? doneEntries.findIndex((e) => e.key === selected.key) : -1;
  const q = search.trim().toLowerCase();
  const visibleEntries = q
    ? doneEntries.filter((e) => `${e.form?.name} ${e.form?.email} ${e.file.name}`.toLowerCase().includes(q))
    : doneEntries;
  const go = (delta: number) => {
    const list = visibleEntries.length ? visibleEntries : doneEntries;
    const i = list.findIndex((e) => e.key === selected?.key);
    const next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
    if (next) setSelectedKey(next.key);
  };
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(-1);
    }
  };
  const setSelectedForm = (updater: (prev: CandidateFormState) => CandidateFormState) => {
    if (!selected) return;
    setEntries((prev) => prev.map((e) => (e.key === selected.key && e.form ? { ...e, form: updater(e.form) } : e)));
  };
  const selectedFile = selected?.file;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          "max-h-[92vh] overflow-y-auto code-scrollbar",
          step === "preview" ? (multi ? "sm:max-w-5xl" : "sm:max-w-2xl") : "sm:max-w-lg",
        )}
      >
        <DialogHeader>
          <DialogTitle>{bulk ? "Bulk upload resumes" : "Import by Resumes"}</DialogTitle>
          <DialogDescription>
            {bulk
              ? "Drop many PDF resumes, review each candidate, then create all sessions in one go."
              : "Upload PDF resumes and let AI extract session information."}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between px-4 py-3">
          {["Upload", "Review", "Complete"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  i <= stepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-sm ${i <= stepIndex ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
              {i < 2 && <div className={`mx-2 h-px w-12 ${i < stepIndex ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        <div className="min-h-[240px] space-y-4">
          {step === "upload" && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (!isParsing && e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                }}
                className={cn(
                  "rounded-lg border border-dashed transition-colors",
                  dragOver && "border-primary bg-primary/5",
                )}
              >
                {entries.length === 0 ? (
                  <button
                    type="button"
                    className="flex w-full flex-col items-center gap-2 py-10 text-sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-5 w-5" />
                    {bulk ? "Drop PDF resumes here or click to choose" : "Upload PDF resumes"}
                    <span className="text-xs text-muted-foreground">
                      {bulk
                        ? "Select as many as you like — they are parsed 3 at a time."
                        : "You can select multiple resumes at once. Each will be parsed by AI individually."}
                    </span>
                  </button>
                ) : (
                  <div className="space-y-2 p-2">
                    {bulk && (
                      <div className="space-y-1 px-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>
                            {parsedCount}/{entries.length} processed · {doneEntries.length} ok
                            {errorEntries.length ? ` · ${errorEntries.length} failed` : ""}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${entries.length ? (parsedCount / entries.length) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="max-h-[300px] space-y-1.5 overflow-y-auto code-scrollbar">
                      {entries.map((entry) => (
                        <div key={entry.key} className="flex items-center gap-2 overflow-hidden rounded-lg border px-3 py-2">
                          {entry.status === "pending" && <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
                          {entry.status === "parsing" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                          {entry.status === "done" && <CheckCircle2 className="h-4 w-4 shrink-0 text-secondary-500" />}
                          {entry.status === "error" && <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}
                          <div className="w-0 flex-1 overflow-hidden">
                            <p className="truncate text-sm">{entry.file.name}</p>
                            {entry.status === "parsing" && entry.streamText && (
                              <p className="truncate font-mono text-[11px] text-muted-foreground">{entry.streamText.slice(-80)}</p>
                            )}
                            {entry.status === "done" && entry.form && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {entry.form.name || "(no name)"}
                                {entry.form.email ? ` · ${entry.form.email}` : ""}
                                {entry.form.phone ? ` · ${entry.form.phone}` : ""}
                              </p>
                            )}
                            {entry.status === "error" && <p className="mt-0.5 text-xs text-destructive">{entry.errorMsg}</p>}
                          </div>
                          {entry.status === "error" && !isParsing && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 shrink-0 p-0"
                              title="Retry"
                              onClick={() => void handleStartParsing([entry])}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!isParsing && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 shrink-0 p-0"
                              onClick={() => setEntries((prev) => prev.filter((e) => e.key !== entry.key))}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    {!isParsing && (
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="mr-2 h-3.5 w-3.5" />
                        Add more files
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <div className="flex items-center gap-2">
                  {errorEntries.length > 0 && !isParsing && (
                    <Button variant="outline" size="sm" onClick={() => void handleStartParsing(errorEntries)}>
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      Retry failed ({errorEntries.length})
                    </Button>
                  )}
                  {allDone && doneEntries.length > 0 && (
                    <Button onClick={() => setStep("preview")}>Review ({doneEntries.length})</Button>
                  )}
                  {!allDone && entries.length > 0 && (
                    <AiButton size="sm" loading={isParsing} onClick={() => void handleStartParsing()}>
                      {isParsing ? `Parsing ${parsedCount}/${entries.length}...` : `Parse resumes (${pendingOrParsing.length})`}
                    </AiButton>
                  )}
                </div>
              </div>

              {allDone && errorEntries.length > 0 && doneEntries.length === 0 && (
                <p className="text-center text-sm text-destructive">
                  All resumes failed to parse. Retry or check the files.
                </p>
              )}
            </>
          )}

          {step === "preview" && selected && (
            <div className="-mx-6 -mb-6 flex flex-col">
              <div className={cn("grid gap-4 px-6", multi && "md:grid-cols-[260px_1fr]")}>
                {/* ── Sidebar ── */}
                {multi && (
                  <aside className="flex max-h-[62vh] flex-col rounded-xl border bg-muted/20">
                    <div className="border-b p-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search candidates"
                          className="h-8 pl-8 text-sm"
                        />
                      </div>
                    </div>
                    <div
                      ref={listRef}
                      tabIndex={0}
                      onKeyDown={onListKeyDown}
                      className="flex-1 space-y-1 overflow-y-auto p-1.5 outline-none code-scrollbar"
                      aria-label="Candidates (use arrow keys)"
                    >
                      {visibleEntries.map((e) => {
                        const bad = Object.keys(errorsFor(e)).length > 0;
                        const pct = completionPercent(e.form!);
                        const active = e.key === selected.key;
                        return (
                          <button
                            key={e.key}
                            type="button"
                            onClick={() => setSelectedKey(e.key)}
                            className={cn(
                              "relative flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted",
                              active && "bg-background shadow-sm ring-1 ring-primary/40",
                            )}
                          >
                            {active && (
                              <motion.span
                                layoutId="resume-active"
                                className="absolute inset-y-1 left-0 w-1 rounded-full bg-primary"
                              />
                            )}
                            <Avatar name={e.form!.name} size="sm" />
                            <span className="w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{e.form!.name || "Unnamed"}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">{e.file.name}</span>
                              <span className="mt-1 flex items-center gap-1.5">
                                <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                                  <span
                                    className={cn("block h-full rounded-full", bad ? "bg-destructive" : "bg-primary")}
                                    style={{ width: `${pct}%` }}
                                  />
                                </span>
                                <span className="text-[10px] tabular-nums text-muted-foreground">{pct}%</span>
                              </span>
                            </span>
                            <StatusBadge status={bad ? "fix" : "ready"} />
                          </button>
                        );
                      })}
                      {entries
                        .filter((e) => e.status === "error")
                        .map((e) => (
                          <div key={e.key} className="flex items-center gap-2.5 rounded-lg px-2 py-2 opacity-70">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                              <AlertCircle className="h-4 w-4" />
                            </span>
                            <span className="w-0 flex-1 truncate text-[11px] text-muted-foreground">{e.file.name}</span>
                            <StatusBadge status="failed" />
                          </div>
                        ))}
                      {pendingOrParsing.map((e) => (
                        <div key={e.key} className="flex items-center gap-2.5 px-2 py-2">
                          <Skeleton className="h-8 w-8 rounded-full" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3 w-3/4" />
                            <Skeleton className="h-2 w-1/2" />
                          </div>
                        </div>
                      ))}
                      {visibleEntries.length === 0 && (
                        <p className="px-2 py-6 text-center text-xs text-muted-foreground">No matches</p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1 border-t p-2">
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={selIdx <= 0} onClick={() => go(-1)}>
                        <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                        Previous
                      </Button>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {selIdx + 1} / {doneEntries.length}
                      </span>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={selIdx >= doneEntries.length - 1} onClick={() => go(1)}>
                        Next
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </aside>
                )}

                {/* ── Detail panel ── */}
                <div className="max-h-[62vh] overflow-y-auto pr-1 code-scrollbar">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={selected.key}
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="space-y-3"
                    >
                      {/* Header card */}
                      <div className="rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                          <Avatar name={selected.form!.name} size="lg" />
                          <div className="w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-base font-semibold">{selected.form!.name || "Unnamed candidate"}</h3>
                              <StatusBadge status={Object.keys(errorsFor(selected)).length ? "fix" : "ready"} />
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              {previewUrl ? (
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex max-w-[260px] items-center gap-1 rounded-full border bg-background px-2 py-0.5 hover:text-foreground"
                                  title="Preview PDF"
                                >
                                  <FileText className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{selected.file.name}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              ) : null}
                              <span className="tabular-nums">{completionPercent(selected.form!)}% complete</span>
                            </div>
                          </div>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-destructive">
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                Remove
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove this candidate?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {selected.form!.name || selected.file.name} will not be imported. You can re-upload the resume later.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => setEntries((prev) => prev.filter((e) => e.key !== selected.key))}
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                        <div className="mt-3 space-y-2">
                          <SkillChips
                            id={`${selected.key}-skills`}
                            skills={selected.form!.skills}
                            onChange={(skills) => setSelectedForm((p) => ({ ...p, skills }))}
                          />
                          <TailorToggle form={selected.form!} setForm={setSelectedForm} />
                        </div>
                      </div>

                      <CandidateFormFields
                        key={selected.key}
                        idPrefix={`${selected.key}-`}
                        form={selected.form!}
                        setForm={setSelectedForm}
                        errors={errorsFor(selected)}
                        missingHints
                        hideSkills
                      />
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* ── Sticky footer ── */}
              <div className="sticky bottom-0 mt-4 space-y-3 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <SendLinkOptions
                  options={deliveryOptions.data}
                  sendEmail={sendEmail}
                  setSendEmail={setSendEmail}
                  sendWhatsapp={sendWhatsapp}
                  setSendWhatsapp={setSendWhatsapp}
                  email={selected.form!.email}
                  phone={selected.form!.phone}
                  bulk={multi}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {validCount} ready
                    </span>
                    {invalidCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 font-medium text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {invalidCount} need fixing
                      </span>
                    )}
                    {errorEntries.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-muted-foreground">
                        {errorEntries.length} failed to parse
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep("upload")}>
                      Back
                    </Button>
                    <Button onClick={handleImport} disabled={bulkCreate.isLoading || doneEntries.length === 0 || invalidCount > 0}>
                      {bulkCreate.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {bulkCreate.isLoading
                        ? "Creating sessions..."
                        : `Create ${validCount} session${validCount !== 1 ? "s" : ""}`}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "preview" && !selected && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium">No candidates left to import</p>
              <p className="text-xs text-muted-foreground">Go back to upload more resumes.</p>
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
            </div>
          )}

          {step === "complete" && (
            <div className="flex flex-col items-center py-8">
              <CheckCircle2 className="h-12 w-12 text-secondary-500" />
              <h3 className="mt-4 text-lg font-semibold">Import Complete</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Created {summary?.created ?? 0} session{(summary?.created ?? 0) !== 1 ? "s" : ""}
                {summary && summary.total > summary.created ? ` (${summary.total - summary.created} skipped)` : ""}.
              </p>
              {summary?.delivery &&
                summary.delivery.email.sent + summary.delivery.email.failed + summary.delivery.whatsapp.sent + summary.delivery.whatsapp.failed > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    WhatsApp: {summary.delivery.whatsapp.sent} sent, {summary.delivery.whatsapp.failed} failed · Email:{" "}
                    {summary.delivery.email.sent} sent, {summary.delivery.email.failed} failed
                  </p>
                )}
              <Button className="mt-6" onClick={handleClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
