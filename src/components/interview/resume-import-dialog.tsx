"use client";

import { useOrg } from "@/components/org-provider";
import { AiButton } from "@/components/ui/ai-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import {
    AlertCircle,
    CheckCircle2,
    FileText,
    Loader2,
    Trash2,
    Upload,
    X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ResumeImportDialogProps {
  interviewId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

interface ParsedCandidate {
  name: string;
  email?: string;
  phone?: string;
  gender?: string;
  birthday?: string;
  education?: string;
  school?: string;
  major?: string;
  graduationYear?: number;
  workExperience?: string;
  notes?: string;
}

interface ResumeEntry {
  file: File;
  status: "pending" | "parsing" | "done" | "error";
  parsed: ParsedCandidate | null;
  errorMsg?: string;
  streamText?: string;
}

type Step = "upload" | "preview" | "complete";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIRTHDAY_RE = /^\d{4}(-\d{2}){0,2}$/;

function validateCandidate(c: ParsedCandidate): Record<string, string> {
  const err: Record<string, string> = {};
  if (!c.name?.trim()) err.name = "Name is required";
  if (c.email?.trim() && !EMAIL_RE.test(c.email.trim())) err.email = "Invalid email";
  const phone = c.phone?.replace(/[\s()-]/g, "") ?? "";
  if (phone && !/^\+\d{7,15}$/.test(phone)) err.phone = "Use + and country code, e.g. +919876543210";
  if (c.birthday?.trim() && !BIRTHDAY_RE.test(c.birthday.trim())) err.birthday = "Use YYYY-MM or YYYY-MM-DD";
  if (c.graduationYear && (Number(c.graduationYear) < 1950 || Number(c.graduationYear) > 2100))
    err.graduationYear = "Invalid year";
  return err;
}

async function parseOneResume(
  file: File,
  onStream: (text: string) => void,
  organizationId?: string,
  interviewId?: string,
): Promise<ParsedCandidate> {
  const formData = new FormData();
  formData.append("file", file);
  if (organizationId) formData.append("organizationId", organizationId);
  if (interviewId) formData.append("interviewId", interviewId);

  const res = await fetch("/api/ai/parse-resume", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.error || "Failed to parse resume");
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";

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
        if (error) throw new Error(error);
        if (token) {
          accumulated += token;
          onStream(accumulated);
        }
      } catch {
        // skip malformed SSE
      }
    }
  }

  const cleaned = accumulated
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  return JSON.parse(cleaned) as ParsedCandidate;
}

export function ResumeImportDialog({
  interviewId,
  open,
  onOpenChange,
  onImported,
}: ResumeImportDialogProps) {
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<ResumeEntry[]>([]);
  const [step, setStep] = useState<Step>("upload");
  const [importedCount, setImportedCount] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const abortRef = useRef(false);
  const [showMore, setShowMore] = useState(false);
  const deliveryOptions = trpc.candidate.deliveryOptions.useQuery({ interviewId }, { enabled: open });
  const [sendEmail, setSendEmail] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  useEffect(() => {
    if (deliveryOptions.data) {
      setSendEmail(deliveryOptions.data.email);
      setSendWhatsapp(deliveryOptions.data.whatsapp);
    }
  }, [deliveryOptions.data]);

  const updateField = useCallback(
    (entry: ResumeEntry, field: keyof ParsedCandidate, value: string) => {
      setEntries((prev) =>
        prev.map((e) =>
          e === entry && e.parsed
            ? {
                ...e,
                parsed: {
                  ...e.parsed,
                  [field]: field === "graduationYear" ? (value ? Number(value) : undefined) : value,
                },
              }
            : e,
        ),
      );
    },
    [],
  );
  const removeParsed = useCallback((entry: ResumeEntry) => {
    setEntries((prev) => prev.filter((e) => e !== entry));
  }, []);

  const bulkCreate = trpc.candidate.bulkCreate.useMutation({
    onSuccess: (data) => {
      setImportedCount(data.created);
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
      setStep("complete");
      onImported();
    },
    onError: (err) => {
      toast({
        title: "Import failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFilesSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const newEntries: ResumeEntry[] = Array.from(files).map((file) => ({
        file,
        status: "pending" as const,
        parsed: null,
      }));

      setEntries((prev) => [...prev, ...newEntries]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const removeEntry = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleStartParsing = useCallback(async () => {
    setIsParsing(true);
    abortRef.current = false;
    let successCount = 0;

    for (let i = 0; i < entries.length; i++) {
      if (abortRef.current) break;
      if (entries[i].status === "done") {
        successCount++;
        continue;
      }

      setEntries((prev) =>
        prev.map((e, idx) =>
          idx === i ? { ...e, status: "parsing", streamText: "" } : e,
        ),
      );

      try {
        const parsed = await parseOneResume(entries[i].file, (text) => {
          setEntries((prev) =>
            prev.map((e, idx) =>
              idx === i ? { ...e, streamText: text } : e,
            ),
          );
        }, currentOrg?.id, interviewId);

        setEntries((prev) =>
          prev.map((e, idx) =>
            idx === i
              ? { ...e, status: "done", parsed, streamText: undefined }
              : e,
          ),
        );
        successCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Parse failed";
        setEntries((prev) =>
          prev.map((e, idx) =>
            idx === i
              ? { ...e, status: "error", errorMsg: msg, streamText: undefined }
              : e,
          ),
        );
      }
    }

    setIsParsing(false);
    if (successCount > 0) setStep("preview");
  }, [entries, currentOrg?.id, interviewId]);

  const successEntries = entries.filter((e) => e.status === "done" && e.parsed);
  const rowErrors = successEntries.map((e) => validateCandidate(e.parsed!));
  const invalidCount = rowErrors.filter((r) => Object.keys(r).length > 0).length;
  const validCount = successEntries.length - invalidCount;

  const handleImport = useCallback(() => {
    if (successEntries.some((e) => Object.keys(validateCandidate(e.parsed!)).length)) return;
    const candidates = successEntries.map((e) => e.parsed!);

    if (candidates.length === 0) return;

    bulkCreate.mutate({
      interviewId,
      candidates: candidates.map((c) => ({
        name: c.name.trim(),
        email: c.email?.trim() || "",
        phone: c.phone?.replace(/[\s()-]/g, "") || undefined,
        gender: c.gender || undefined,
        birthday: c.birthday || undefined,
        education: c.education || undefined,
        school: c.school || undefined,
        major: c.major || undefined,
        graduationYear: c.graduationYear
          ? Number(c.graduationYear)
          : undefined,
        workExperience: c.workExperience || undefined,
        notes: c.notes || undefined,
      })),
      sendVia: {
        email: sendEmail && !!deliveryOptions.data?.email,
        whatsapp: sendWhatsapp && !!deliveryOptions.data?.whatsapp,
      },
    });
  }, [successEntries, interviewId, bulkCreate, sendEmail, sendWhatsapp, deliveryOptions.data]);

  const handleClose = useCallback(() => {
    abortRef.current = true;
    setEntries([]);
    setStep("upload");
    setImportedCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onOpenChange(false);
  }, [onOpenChange]);

  const pendingOrParsing = entries.filter(
    (e) => e.status === "pending" || e.status === "parsing",
  );
  const errorEntries = entries.filter((e) => e.status === "error");
  const stepIndex = step === "upload" ? 0 : step === "preview" ? 1 : 2;
  const allDone = entries.length > 0 && pendingOrParsing.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={step === "preview" ? "sm:max-w-5xl" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>Import by Resumes</DialogTitle>
          <DialogDescription>
            Upload PDF resumes and let AI extract session information.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between px-4 py-3">
          {["Upload", "Review", "Complete"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  i <= stepIndex
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {i < stepIndex ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-sm ${
                  i <= stepIndex ? "font-medium" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
              {i < 2 && (
                <div
                  className={`mx-2 h-px w-12 ${
                    i < stepIndex ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[240px] space-y-4">
          {step === "upload" && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={handleFilesSelected}
              />

              {entries.length === 0 ? (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full border-dashed py-8"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload PDF resumes
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    You can select multiple resumes at once. Each will be parsed by AI individually.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="max-h-[300px] space-y-1.5 overflow-y-auto code-scrollbar">
                    {entries.map((entry, idx) => (
                      <div
                        key={`${entry.file.name}-${idx}`}
                        className="flex items-center gap-2 overflow-hidden rounded-lg border px-3 py-2"
                      >
                        {entry.status === "pending" && (
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        {entry.status === "parsing" && (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                        )}
                        {entry.status === "done" && (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-secondary-500" />
                        )}
                        {entry.status === "error" && (
                          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                        )}

                        <div className="w-0 flex-1 overflow-hidden">
                          <p className="truncate text-sm">{entry.file.name}</p>
                          {entry.status === "parsing" && entry.streamText && (
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              {entry.streamText.slice(-80)}
                            </p>
                          )}
                          {entry.status === "done" && entry.parsed && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {entry.parsed.name}
                              {entry.parsed.email ? ` · ${entry.parsed.email}` : ""}
                            </p>
                          )}
                          {entry.status === "error" && (
                            <p className="mt-0.5 text-xs text-destructive">
                              {entry.errorMsg}
                            </p>
                          )}
                        </div>

                        {!isParsing && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 shrink-0 p-0"
                            onClick={() => removeEntry(idx)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  {!isParsing && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="mr-2 h-3.5 w-3.5" />
                      Add more files
                    </Button>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <div className="flex items-center gap-2">
                  {allDone && successEntries.length > 0 && (
                    <Button onClick={() => setStep("preview")}>
                      Review ({successEntries.length})
                    </Button>
                  )}
                  {!allDone && entries.length > 0 && (
                    <AiButton
                      size="sm"
                      loading={isParsing}
                      onClick={handleStartParsing}
                    >
                      {isParsing
                        ? "Parsing..."
                        : `Parse resumes (${entries.length})`}
                    </AiButton>
                  )}
                </div>
              </div>

              {allDone && errorEntries.length > 0 && successEntries.length === 0 && (
                <p className="text-center text-sm text-destructive">
                  All resumes failed to parse. Please check the files and try again.
                </p>
              )}
            </>
          )}

          {step === "preview" && (
            <>
              <div className="rounded-lg border">
                <div className="max-h-[360px] overflow-auto code-scrollbar">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">#</th>
                        <th className="px-2 py-2 text-left font-medium">Name *</th>
                        <th className="px-2 py-2 text-left font-medium">Email</th>
                        <th className="px-2 py-2 text-left font-medium">Phone (+code)</th>
                        {showMore && (
                          <>
                            <th className="px-2 py-2 text-left font-medium">DOB</th>
                            <th className="px-2 py-2 text-left font-medium">Gender</th>
                            <th className="px-2 py-2 text-left font-medium">Education</th>
                            <th className="px-2 py-2 text-left font-medium">School</th>
                            <th className="px-2 py-2 text-left font-medium">Major</th>
                            <th className="px-2 py-2 text-left font-medium">Grad year</th>
                            <th className="px-2 py-2 text-left font-medium">Experience</th>
                          </>
                        )}
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {successEntries.map((entry, i) => {
                        const c = entry.parsed!;
                        const err = rowErrors[i];
                        const hasErr = Object.keys(err).length > 0;
                        const cell = (field: keyof ParsedCandidate, placeholder: string, w = "w-40") => (
                          <td className="px-2 py-1.5 align-top">
                            <Input
                              value={c[field] == null ? "" : String(c[field])}
                              placeholder={placeholder}
                              onChange={(e) => updateField(entry, field, e.target.value)}
                              className={`h-8 text-sm ${w} ${err[field] ? "border-destructive focus-visible:ring-destructive" : ""}`}
                              title={err[field]}
                            />
                            {err[field] && (
                              <p className="mt-0.5 max-w-[10rem] text-[11px] leading-tight text-destructive">{err[field]}</p>
                            )}
                          </td>
                        );
                        return (
                          <tr key={`${entry.file.name}-${i}`} className={`border-t ${hasErr ? "bg-destructive/5" : ""}`}>
                            <td className="px-2 py-2 align-top text-muted-foreground">{i + 1}</td>
                            {cell("name", "Full name")}
                            {cell("email", "name@example.com", "w-48")}
                            {cell("phone", "+91 98765 43210")}
                            {showMore && (
                              <>
                                {cell("birthday", "YYYY-MM", "w-28")}
                                {cell("gender", "Gender", "w-24")}
                                {cell("education", "Education", "w-28")}
                                {cell("school", "School")}
                                {cell("major", "Major", "w-32")}
                                {cell("graduationYear", "YYYY", "w-20")}
                                {cell("workExperience", "Experience", "w-28")}
                              </>
                            )}
                            <td className="px-2 py-1.5 align-top">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Remove row"
                                onClick={() => removeParsed(entry)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <button
                  type="button"
                  className="text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() => setShowMore((v) => !v)}
                >
                  {showMore ? "Hide extra fields" : "Show all fields (DOB, education…)"}
                </button>
                <label className="flex items-center gap-2" title={deliveryOptions.data?.whatsapp ? "" : "Configure ResilioHub in Integrations"}>
                  <Checkbox
                    checked={sendWhatsapp}
                    disabled={!deliveryOptions.data?.whatsapp}
                    onCheckedChange={(v) => setSendWhatsapp(v === true)}
                  />
                  Send link on WhatsApp
                  {!deliveryOptions.data?.whatsapp && (
                    <span className="text-xs text-muted-foreground">(not configured)</span>
                  )}
                </label>
                <label className="flex items-center gap-2" title={deliveryOptions.data?.email ? "" : "Configure Resend/Brevo in Integrations"}>
                  <Checkbox
                    checked={sendEmail}
                    disabled={!deliveryOptions.data?.email}
                    onCheckedChange={(v) => setSendEmail(v === true)}
                  />
                  Send link by Email
                  {!deliveryOptions.data?.email && (
                    <span className="text-xs text-muted-foreground">(not configured)</span>
                  )}
                </label>
              </div>

              <p className="text-sm text-muted-foreground">
                {validCount} session{validCount !== 1 ? "s" : ""} ready to import.
                {invalidCount > 0 && (
                  <span className="text-destructive"> {invalidCount} row{invalidCount !== 1 ? "s" : ""} need fixing.</span>
                )}
                {errorEntries.length > 0 && (
                  <span className="text-destructive">
                    {" "}{errorEntries.length} failed.
                  </span>
                )}
              </p>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep("upload")}>
                  Back
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={bulkCreate.isLoading || successEntries.length === 0 || invalidCount > 0}
                >
                  {bulkCreate.isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Import ({validCount})
                </Button>
              </div>
            </>
          )}

          {step === "complete" && (
            <div className="flex flex-col items-center py-8">
              <CheckCircle2 className="h-12 w-12 text-secondary-500" />
              <h3 className="mt-4 text-lg font-semibold">Import Complete</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Successfully imported {importedCount} session
                {importedCount !== 1 ? "s" : ""} from resumes.
              </p>
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
