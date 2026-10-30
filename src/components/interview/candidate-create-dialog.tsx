"use client";

import { useOrg } from "@/components/org-provider";
import { AiButton } from "@/components/ui/ai-button";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
    FileText,
    Loader2,
    Sparkles,
    Upload,
    X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    CandidateFormFields,
    EMPTY_CANDIDATE_FORM,
    formToCandidateInput,
    parsedToForm,
    SendLinkOptions,
    validateCandidateForm,
    type CandidateFormState,
} from "./candidate-form";

// --- Main component ---
interface CandidateCreateDialogProps {
  interviewId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}


export function CandidateCreateDialog({
  interviewId,
  open,
  onOpenChange,
  onCreated,
}: CandidateCreateDialogProps) {
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const [form, setForm] = useState<CandidateFormState>({ ...EMPTY_CANDIDATE_FORM });
  const [resumeFile, setResumeFile] = useState<string>("");
  const [parsingResume, setParsingResume] = useState(false);
  const [streamText, setStreamText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deliveryOptions = trpc.candidate.deliveryOptions.useQuery(
    { interviewId },
    { enabled: open },
  );
  const [sendEmail, setSendEmail] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  useEffect(() => {
    if (deliveryOptions.data) {
      setSendEmail(deliveryOptions.data.email);
      setSendWhatsapp(deliveryOptions.data.whatsapp);
    }
  }, [deliveryOptions.data]);
  const streamRef = useRef<HTMLDivElement>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
    streamEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [streamText]);

  const createMutation = trpc.candidate.create.useMutation({
    onSuccess: (data) => {
      const d = (data as { delivery?: Record<string, { status: string; error?: string }> }).delivery ?? {};
      const parts: string[] = [];
      let anyFail = false;
      for (const [ch, label] of [["whatsapp", "WhatsApp"], ["email", "Email"]] as const) {
        const r = d[ch];
        if (!r) continue;
        if (r.status !== "sent") anyFail = true;
        parts.push(`${label}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
      }
      if (parts.length) {
        toast({
          title: anyFail ? "Session added — some messages not sent" : "Session added — invite sent",
          description: parts.join(" · "),
          variant: anyFail ? "destructive" : undefined,
        });
        navigator.clipboard
          .writeText(`${window.location.origin}/i/invite/${data.inviteToken}`)
          .catch(() => {});
      } else if (data.inviteToken) {
        const link = `${window.location.origin}/i/invite/${data.inviteToken}`;
        navigator.clipboard.writeText(link).catch(() => {});
        toast({
          title: "Session added",
          description: "Invite link copied to clipboard",
        });
      } else {
        toast({ title: "Session added" });
      }
      setForm({ ...EMPTY_CANDIDATE_FORM });
      setResumeFile("");
      setStreamText("");
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Failed to add session",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    if (Object.keys(formErrors).length) return;
    createMutation.mutate({
      interviewId,
      ...formToCandidateInput(form),
      sendVia: {
        email: sendEmail && !!deliveryOptions.data?.email && !!form.email.trim(),
        whatsapp: sendWhatsapp && !!deliveryOptions.data?.whatsapp && !!form.phone.trim(),
      },
    });
  };

  const formErrors = validateCandidateForm(form);

  const handleResumeUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setResumeFile(file.name);
      setParsingResume(true);
      setStreamText("");

      try {
        const formData = new FormData();
        formData.append("file", file);
        if (currentOrg?.id) formData.append("organizationId", currentOrg.id);
        if (interviewId) formData.append("interviewId", interviewId);

        const res = await fetch("/api/ai/parse-resume", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json();
          toast({ title: "Failed to parse resume", description: errData.error, variant: "destructive" });
          setParsingResume(false);
          return;
        }

        // Consume SSE stream
        const reader = res.body?.getReader();
        if (!reader) {
          toast({
            title: "Failed to parse resume",
            description: "No response stream",
            variant: "destructive",
          });
          setParsingResume(false);
          return;
        }

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
              if (error) {
                toast({
                  title: "Parse error",
                  description: error,
                  variant: "destructive",
                });
                continue;
              }
              if (token) {
                accumulated += token;
                setStreamText(accumulated);
              }
            } catch {
              // skip malformed SSE
            }
          }
        }

        // Parse final accumulated JSON
        const cleaned = accumulated
          .replace(/```json\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();

        try {
          const parsed = JSON.parse(cleaned);
          setForm((prev) => parsedToForm(parsed, prev));
          toast({ title: "Resume parsed successfully" });
        } catch {
          toast({
            title: "Failed to parse resume result",
            description: "AI response was not valid JSON. Please try again.",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Failed to parse resume",
          description: "Network error. Please try again.",
          variant: "destructive",
        });
      } finally {
        setParsingResume(false);
      }
    },
    [toast, currentOrg?.id, interviewId],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col overflow-y-auto code-scrollbar sm:max-w-lg md:max-w-xl"
        data-tour="save-candidate"
      >
        <SheetHeader>
          <SheetTitle>Create individually</SheetTitle>
          <SheetDescription>
            Add session details manually or extract from a resume.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="-mt-2 flex-1 space-y-3">
          <div>
            <CandidateFormFields form={form} setForm={setForm} errors={Object.fromEntries(Object.entries(formErrors).filter(([k]) => k !== "name"))} />
          </div>

          {/* ── Or divider ── */}
          <div className="my-1 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or extract from resume</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* ── AI Resume Extract ── */}
          <div className="rounded-xl bg-muted/50 p-4">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-5 w-5 text-foreground" />
              <div>
                <p className="text-sm font-semibold">Extract from Resume</p>
                <p className="text-xs text-muted-foreground">
                  Upload a PDF and let AI fill in the details.
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleResumeUpload}
            />

            {resumeFile ? (
              <div
                className={cn(
                  "relative mt-2 overflow-hidden rounded-lg",
                  parsingResume ? "ai-border-spin p-[1.5px]" : "p-0",
                )}
              >
                <div className="relative flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-foreground">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-sm">
                    {resumeFile}
                  </p>
                  {parsingResume ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        setResumeFile("");
                        setStreamText("");
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <AiButton
                wrapperClassName="mt-2 w-full"
                className="w-full"
                size="sm"
                type="button"
                loading={parsingResume}
                onClick={() => fileInputRef.current?.click()}
              >
                {!parsingResume && <Upload className="mr-2 h-3.5 w-3.5" />}
                Upload resume (.pdf)
              </AiButton>
            )}

            {/* Streaming output */}
            {parsingResume && streamText && (
              <div ref={streamRef} className="mt-2 max-h-24 overflow-y-auto rounded-md bg-muted p-2 code-scrollbar">
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {streamText}
                  <span className="animate-pulse text-foreground">|</span>
                </pre>
              </div>
            )}

            {parsingResume && !streamText && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Uploading and analyzing...
              </p>
            )}
            <div ref={streamEndRef} />
          </div>

          <SendLinkOptions
            options={deliveryOptions.data}
            sendEmail={sendEmail}
            setSendEmail={setSendEmail}
            sendWhatsapp={sendWhatsapp}
            setSendWhatsapp={setSendWhatsapp}
            email={form.email}
            phone={form.phone}
          />

          <SheetFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isLoading || parsingResume || Object.keys(formErrors).length > 0}
            >
              {createMutation.isLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save and add
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
