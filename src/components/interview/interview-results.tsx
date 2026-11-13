/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { getLanguage as getCodeLanguage } from "@/lib/code-languages";
import { CodeBlock } from "@/components/code-editor/code-block";
import { useOrg } from "@/components/org-provider";
import { SessionErrorLogButton } from "@/components/session/session-error-log";
import { SessionRow, SessionsTable } from "@/components/session/sessions-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { STRIKE_LABEL } from "@/lib/head-movement";
import { buildReportData } from "@/lib/report-data";
import { PdfBuilderDialog } from "@/components/report/pdf-builder-dialog";
import {
  ReportHero,
  ReportIntegrity,
  ReportQuestions,
  ReportSkills,
  ReportStrengths,
  ReportSummary,
} from "@/components/report/session-report-view";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  BarChart3,
  Camera,
  ChevronDown,
  ChevronUp,
  Clock,
  Code2,
  FileDown,
  Lightbulb,
  Loader2,
  MessageCircle,
  MessageSquare,
  Mic,
  Monitor,
  PenLine,
  Search,
  Settings2,
  SmilePlus,
  Sparkles,
  Tags,
  UserCheck,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
interface QuestionEvaluation {
  question: string;
  score: number;
  evaluation: string;
  highlights?: string[];
  improvements?: string[];
}

interface ResearchFinding {
  question: string;
  summary: string;
  keyTopics?: { topic: string; details: string }[];
  dataPoints?: string[];
}

function MediaReviewActions({
  sessionId,
  status,
  expiresAt,
  clearedAt,
}: {
  sessionId: string;
  status?: string;
  expiresAt?: string | null;
  clearedAt?: string | null;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const mutation = trpc.session.setMediaReview.useMutation({
    onSuccess: (data) => {
      void utils.analysis.getSessionSummary.invalidate({ sessionId });
      void utils.session.listByInterview.invalidate();
      toast({
        title:
          data.status === "approved"
            ? "Approved — media kept"
            : data.status === "declined"
              ? "Declined — media cleared (scores kept)"
              : "Put aside — media auto-clears in 15 days",
      });
    },
    onError: (err) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const current = status ?? "pending";
  const busy = mutation.isLoading;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {current !== "pending" && (
        <Badge variant="secondary" className="capitalize">
          {current === "set_aside" ? "Put aside" : current}
          {current === "set_aside" && expiresAt
            ? ` · until ${new Date(expiresAt).toLocaleDateString()}`
            : ""}
          {clearedAt ? " · media cleared" : ""}
        </Badge>
      )}
      {current === "pending" && !clearedAt && (
        <>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => mutation.mutate({ sessionId, action: "approved" })}
          >
            {busy && mutation.variables?.action === "approved" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserCheck className="mr-1 h-3.5 w-3.5" />
            )}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => mutation.mutate({ sessionId, action: "set_aside" })}
          >
            Put aside
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => mutation.mutate({ sessionId, action: "declined" })}
          >
            Decline
          </Button>
        </>
      )}
    </div>
  );
}

export function InterviewResults({
  interviewId,
  initialSessionId,
  onBack: externalOnBack,
}: {
  interviewId: string;
  initialSessionId?: string;
  onBack?: () => void;
}) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    initialSessionId ?? null,
  );
  const utils = trpc.useUtils();

  const sessions = trpc.session.listByInterview.useQuery({
    interviewId,
    limit: 100,
  });
  const insights = trpc.analysis.getInterviewInsights.useQuery({ interviewId });

  if (selectedSessionId) {
    return (
      <SessionDetail
        sessionId={selectedSessionId}
        onBack={() => {
          if (externalOnBack) {
            externalOnBack();
          } else {
            setSelectedSessionId(null);
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <Users className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total Sessions</p>
              <p className="text-2xl font-bold">
                {insights.data?.totalSessions ?? 0}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <UserCheck className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Participants</p>
              <p className="text-2xl font-bold">
                {insights.data?.totalParticipants ?? 0}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <Clock className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Avg Duration</p>
              <p className="text-2xl font-bold">
                {insights.data?.avgDurationSeconds
                  ? `${Math.round(insights.data.avgDurationSeconds / 60)}m`
                  : "N/A"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <BarChart3 className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Top Themes</p>
              <p className="text-lg font-bold">
                {insights.data?.topThemes?.length ?? 0}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions Table */}
      <SessionsTable
        sessions={(sessions.data?.sessions ?? []) as SessionRow[]}
        isLoading={sessions.isLoading}
        onSessionClick={(s) => setSelectedSessionId(s.id)}
        onDeleteSuccess={() => {
          utils.session.listByInterview.invalidate({ interviewId });
          utils.analysis.getInterviewInsights.invalidate({ interviewId });
        }}
        emptyMessage="No sessions yet. Share the interview link to start collecting responses."
      />

      {/* Themes */}
      {insights.data?.topThemes && insights.data.topThemes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Themes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {insights.data.topThemes.map(([theme, count]) => (
                <Badge key={theme} variant="outline" className="text-sm">
                  {theme} ({count})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SessionDetail({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const summary = trpc.analysis.getSessionSummary.useQuery({ sessionId });
  const completeSession = trpc.session.complete.useMutation();
  const [generating, setGenerating] = useState(false);
  const [autoWaitUntil, setAutoWaitUntil] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [retranscribing, setRetranscribing] = useState(false);
  const [showRetranscribeConfirm, setShowRetranscribeConfirm] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [pdfCapture, setPdfCapture] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [audioCanPlay, setAudioCanPlay] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [exportPercent, setExportPercent] = useState(0);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleGenerateSummary = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, organizationId: currentOrg?.id }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to generate summary");
      }
      await summary.refetch();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate summary";
      toast({
        title: "Summary generation failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [sessionId, summary, currentOrg?.id, toast]);

  const handleRequestReport = useCallback(() => {
    if (summary.data?.status === "IN_PROGRESS") {
      setShowEndConfirm(true);
    } else {
      handleGenerateSummary();
    }
  }, [summary.data?.status, handleGenerateSummary]);

  const handleConfirmEndAndGenerate = useCallback(async () => {
    try {
      await completeSession.mutateAsync({ id: sessionId });
      // The server builds the report itself now; just wait for it.
      setAutoWaitUntil(Date.now() + 3 * 60_000);
      await summary.refetch();
    } catch {
      toast({ title: "Failed to end interview", variant: "destructive" });
      return;
    }
  }, [sessionId, completeSession, summary, toast]);

  // Automatic report in progress (server-side): show progress and poll.
  const reportStatus = summary.data?.reportStatus ?? null;
  const hasCaptureFailure = !!(
    summary.data?.insights &&
    typeof summary.data.insights === "object" &&
    (summary.data.insights as { captureFailure?: unknown }).captureFailure
  );
  const reportPending =
    !!summary.data &&
    !summary.data.summary &&
    !hasCaptureFailure &&
    (summary.data.status === "COMPLETED" || summary.data.status === "ABANDONED") &&
    (reportStatus === "PENDING" || reportStatus === "GENERATING" || autoWaitUntil > nowTick);
  const reportFailed = reportStatus === "FAILED" && !reportPending;
  useEffect(() => {
    if (!reportPending) return;
    const t = setInterval(() => {
      setNowTick(Date.now());
      void summary.refetch();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportPending]);

  const handleRetranscribe = useCallback(async () => {
    setRetranscribing(true);
    try {
      const res = await fetch("/api/session/retranscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Re-transcribe failed");
      await summary.refetch();
      toast({
        title: "Transcript rebuilt from recording",
        description:
          body.summary === "scored"
            ? `${body.candidateLines} candidate answers added. Report updated.`
            : `${body.candidateLines} candidate answers added. Generate the report again if it didn't update.`,
      });
    } catch (err) {
      toast({
        title: "Re-transcribe failed",
        description: err instanceof Error ? err.message : "Re-transcribe failed",
        variant: "destructive",
      });
    } finally {
      setRetranscribing(false);
    }
  }, [sessionId, summary, toast]);

  // Auto-generate report for completed sessions that have no summary yet
  const autoTriggered = useRef(false);
  useEffect(() => {
    if (
      !autoTriggered.current &&
      !summary.isLoading &&
      summary.data &&
      summary.data.status === "COMPLETED" &&
      !summary.data.summary &&
      !(summary.data.insights as { captureFailure?: unknown } | null)?.captureFailure &&
      summary.data.messages.length > 0
    ) {
      autoTriggered.current = true;
      handleGenerateSummary();
    }
  }, [summary.isLoading, summary.data, handleGenerateSummary]);

  const handleExportPDF = useCallback(async () => {
    if (!reportRef.current) return;

    const participant =
      summary.data?.participantName ||
      summary.data?.participantEmail ||
      "anonymous";
    const title = summary.data?.interviewTitle || "interview";
    const fileName = `${title.replace(/\s+/g, "_")}_${participant.replace(/\s+/g, "_")}_report.pdf`;

    // Let user choose save location first (Chrome/Edge)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fileHandle: any = null;
    try {
      if ("showSaveFilePicker" in window) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: "PDF Document",
              accept: { "application/pdf": [".pdf"] },
            },
          ],
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }

    setExporting(true);
    setExportPercent(0);
    setExportProgress("Preparing...");
    setPdfCapture(true);
    await new Promise((r) => setTimeout(r, 150));

    // Yield to let the browser paint before each heavy stage
    const paint = () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );

    // Animate progress during the slow html2canvas phase
    let animPct = 5;
    const timer = setInterval(() => {
      animPct += (75 - animPct) * 0.04;
      setExportPercent(Math.round(animPct));
    }, 200);

    try {
      setExportProgress("Rendering...");
      setExportPercent(5);
      await paint();

      const { jsPDF } = await import("jspdf");
      const { captureElementForPdf, pageSlicesForCanvas, sliceToJpeg } = await import("@/lib/report-pdf");

      // Size-capped capture (one huge canvas came back solid black on long reports).
      const canvas = await captureElementForPdf(reportRef.current, 2);
      clearInterval(timer);

      setExportProgress("Building PDF...");
      setExportPercent(80);
      await paint();

      const imgWidth = 190;
      const pageHeight = 277;
      const pxPerMm = canvas.width / imgWidth;
      const slices = pageSlicesForCanvas(reportRef.current, canvas, pageHeight * pxPerMm);

      setExportPercent(90);
      await paint();

      // One image slice per page instead of the whole report image on every page.
      const pdf = new jsPDF("p", "mm", "a4");
      slices.forEach(([start, end], idx) => {
        if (idx > 0) pdf.addPage();
        const { data, height } = sliceToJpeg(canvas, start, end);
        pdf.addImage(data, "JPEG", 10, 10, imgWidth, height / pxPerMm);
      });
      canvas.width = 0;
      canvas.height = 0;

      setExportProgress("Saving...");
      setExportPercent(95);
      await paint();

      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(pdf.output("blob"));
        await writable.close();
      } else {
        pdf.save(fileName);
      }
      setExportPercent(100);
    } catch (err) {
      console.error("PDF export failed:", err);
      toast({
        title: "PDF export failed",
        description: err instanceof Error ? err.message : "Could not build the PDF",
        variant: "destructive",
      });
    } finally {
      clearInterval(timer);
      setPdfCapture(false);
      setExporting(false);
      setExportProgress("");
      setExportPercent(0);
    }
  }, [summary.data, toast]);

  // Parse insights data
  const insightsData = summary.data?.insights as
    | {
        keyInsights?: string[];
        criteriaEvaluations?: {
          name: string;
          score: number;
          reasoning: string;
        }[];
        questionEvaluations?: QuestionEvaluation[];
        researchFindings?: ResearchFinding[];
        captureFailure?: { reason: string; recordingAvailable?: boolean } | null;
        transcriptSource?: string;
        toneAnalysis?: {
          overall?: string;
          details?: string;
          segments?: {
            question: string;
            tone: string;
            confidence: string;
            notes: string;
          }[];
        };
      }
    | string[]
    | null;
  const keyInsights = Array.isArray(insightsData)
    ? insightsData
    : (insightsData?.keyInsights ?? []);
  const criteriaEvaluations = Array.isArray(insightsData)
    ? []
    : (insightsData?.criteriaEvaluations ?? []);
  const questionEvaluations: QuestionEvaluation[] = Array.isArray(insightsData)
    ? []
    : (insightsData?.questionEvaluations ?? []);
  const researchFindings: ResearchFinding[] = Array.isArray(insightsData)
    ? []
    : (insightsData?.researchFindings ?? []);
  const toneAnalysis = Array.isArray(insightsData)
    ? null
    : (insightsData?.toneAnalysis ?? null);
  const captureFailure = Array.isArray(insightsData)
    ? null
    : (insightsData?.captureFailure ?? null);
  const transcriptFromRecording =
    !Array.isArray(insightsData) && insightsData?.transcriptSource === "recording";
  const canRetranscribe =
    !!summary.data?.audioRecordingUrl && summary.data?.status === "COMPLETED";

  const sentimentData = summary.data?.sentiment as {
    overall?: string;
    details?: string;
  } | null;

  const antiCheatingLog = (summary.data?.antiCheatingLog ?? []) as {
    type: string;
    timestamp: number;
    detail?: string;
    imageUrl?: string;
    imagePath?: string;
  }[];
  const strikeEvents = antiCheatingLog;

  const hasReport = !!(
    summary.data?.summary ||
    criteriaEvaluations.length > 0 ||
    questionEvaluations.length > 0 ||
    researchFindings.length > 0 ||
    keyInsights.length > 0 ||
    (summary.data?.themes && summary.data.themes.length > 0)
  );

  const report = useMemo(() => buildReportData(summary.data), [summary.data]);
  const transcriptMessages = useMemo(() => {
    const msgs = (summary.data?.messages ?? []) as {
      id: string;
      role: string;
      content: string;
      contentType?: string;
      transcription?: string | null;
      timestamp?: string;
    }[];
    return msgs
      .filter((m) => m.contentType !== "WHITEBOARD" && m.contentType !== "CODE")
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.timestamp ?? 0).getTime();
        const tb = new Date(b.timestamp ?? 0).getTime();
        if (ta !== tb) return ta - tb;
        return String(a.id ?? "").localeCompare(String(b.id ?? ""));
      });
  }, [summary.data?.messages]);
  const [pdfBuilderOpen, setPdfBuilderOpen] = useState(false);

  const formatMsgTime = (ts?: string) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Results
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <SessionErrorLogButton sessionId={sessionId} />
          <MediaReviewActions
            sessionId={sessionId}
            status={(summary.data as { mediaReviewStatus?: string } | undefined)?.mediaReviewStatus}
            expiresAt={(summary.data as { mediaExpiresAt?: string | null } | undefined)?.mediaExpiresAt}
            clearedAt={(summary.data as { mediaClearedAt?: string | null } | undefined)?.mediaClearedAt}
          />
          {canRetranscribe && !captureFailure && (
            <Button
              variant="outline"
              onClick={() => setShowRetranscribeConfirm(true)}
              disabled={retranscribing}
            >
              {retranscribing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mic className="mr-2 h-4 w-4" />
              )}
              {retranscribing ? "Re-transcribing..." : "Re-transcribe from recording"}
            </Button>
          )}
          {hasReport && (
            <Button onClick={() => setPdfBuilderOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Customize PDF
            </Button>
          )}
          {hasReport && (
            <Button
              variant="outline"
              title="Quick export of the on-screen report"
              onClick={handleExportPDF}
              disabled={exporting}
              className="relative overflow-hidden"
            >
              {exporting && (
                <div
                  className="absolute inset-0 bg-primary/10 transition-all duration-300 ease-out"
                  style={{ width: `${exportPercent}%` }}
                />
              )}
              <span className="relative flex items-center">
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="mr-2 h-4 w-4" />
                )}
                {exporting ? exportProgress || "Exporting..." : "Quick export"}
              </span>
            </Button>
          )}
        </div>
      </div>

      {summary.isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Report area — this div is captured for PDF */}
          <div
            ref={reportRef}
            className={cn(
              "space-y-6 bg-background",
              pdfCapture && "pdf-capture",
            )}
          >
            <ReportHero data={report} />


            {captureFailure && (
              <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 no-print">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <p className="text-sm">
                    Candidate answers weren&apos;t captured, so this interview was not scored.
                    {canRetranscribe
                      ? " Re-transcribe from recording."
                      : " There is no recording to rebuild them from."}
                  </p>
                  {canRetranscribe && (
                    <Button size="sm" onClick={handleRetranscribe} disabled={retranscribing}>
                      {retranscribing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Mic className="mr-2 h-4 w-4" />
                      )}
                      {retranscribing ? "Re-transcribing..." : "Re-transcribe from recording"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Generate report if no summary yet */}
            {!summary.data?.summary && !captureFailure && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  {generating || reportPending ? (
                    <>
                      <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
                      <p className="mb-1 font-medium">Generating report…</p>
                      <p className="text-sm text-muted-foreground">
                        Analyzing the interview. This usually takes under a minute.
                      </p>
                    </>
                  ) : (
                    <>
                      <Sparkles className="mb-3 h-8 w-8 text-muted-foreground" />
                      <p className="mb-1 font-medium">
                        {reportFailed ? "The report didn't finish" : "No report generated yet"}
                      </p>
                      <p className="mb-4 text-sm text-muted-foreground">
                        {reportFailed
                          ? "Automatic generation failed. Try again."
                          : "Generate an analysis of this interview session."}
                      </p>
                      <Button
                        onClick={handleRequestReport}
                        disabled={!summary.data?.messages.length}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generate Report
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            <ReportSummary data={report} />
            <ReportSkills data={report} />
            <ReportStrengths data={report} />

            <ReportQuestions data={report} />

            {/* Research Findings */}
            {researchFindings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Research Findings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {researchFindings.map((rf, i) => (
                    <div key={i} className="space-y-3 rounded-lg border p-4">
                      <p className="text-sm font-medium">{rf.question}</p>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                        {rf.summary}
                      </p>
                      {rf.keyTopics && rf.keyTopics.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-secondary-600 dark:text-secondary-400">
                            Key Topics
                          </p>
                          {rf.keyTopics.map((kt, j) => (
                            <div key={j} className="rounded-md bg-muted/50 p-3">
                              <p className="text-xs font-semibold">
                                {kt.topic}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {kt.details}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                      {rf.dataPoints && rf.dataPoints.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-tertiary-600 dark:text-tertiary-300">
                            Key Data Points
                          </p>
                          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                            {rf.dataPoints.map((dp, j) => (
                              <li key={j}>{String(dp)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Tone & Communication */}
            {toneAnalysis &&
              (toneAnalysis.details ||
                (toneAnalysis.segments &&
                  toneAnalysis.segments.length > 0)) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Volume2 className="h-4 w-4" />
                      Tone &amp; Communication
                      {toneAnalysis.overall && (
                        <Badge variant="outline" className="ml-auto capitalize">
                          {toneAnalysis.overall}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {toneAnalysis.details && (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {toneAnalysis.details}
                      </p>
                    )}
                    {toneAnalysis.segments &&
                      toneAnalysis.segments.length > 0 && (
                        <div className="space-y-3">
                          {toneAnalysis.segments.map((seg, i) => (
                            <div
                              key={i}
                              className="rounded-lg border p-3 space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium truncate max-w-[70%]">
                                  {seg.question}
                                </p>
                                <div className="flex gap-2">
                                  <Badge
                                    variant="outline"
                                    className="capitalize text-xs"
                                  >
                                    {seg.tone}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-xs capitalize",
                                      seg.confidence === "high" &&
                                        "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400",
                                      seg.confidence === "low" &&
                                        "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400",
                                    )}
                                  >
                                    {seg.confidence}
                                  </Badge>
                                </div>
                              </div>
                              {seg.notes && (
                                <p className="text-xs text-muted-foreground">
                                  {seg.notes}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                  </CardContent>
                </Card>
              )}

            {/* Key Insights + Themes + Sentiment */}
            {(keyInsights.length > 0 ||
              (summary.data?.themes && summary.data.themes.length > 0) ||
              sentimentData) && (
              <div className="grid gap-6 md:grid-cols-3">
                {keyInsights.length > 0 && (
                  <Card
                    className={
                      !sentimentData &&
                      (!summary.data?.themes ||
                        summary.data.themes.length === 0)
                        ? "md:col-span-3"
                        : ""
                    }
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Lightbulb className="h-4 w-4" />
                        Key Insights
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="list-disc space-y-1.5 pl-4 text-sm">
                        {keyInsights.map((insight, i) => (
                          <li key={i}>{String(insight)}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {summary.data?.themes && summary.data.themes.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Tags className="h-4 w-4" />
                        Themes
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {summary.data.themes.map((theme: string) => (
                          <Badge key={theme} variant="outline">
                            {theme}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {sentimentData && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <SmilePlus className="h-4 w-4" />
                          Sentiment
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            sentimentData.overall === "positive"
                              ? "border-secondary-200 bg-secondary-50 text-secondary-700 dark:border-secondary-800 dark:bg-secondary-900/30 dark:text-secondary-300"
                              : sentimentData.overall === "negative"
                                ? "border-destructive-200 bg-destructive-50 text-destructive-700 dark:border-destructive-800 dark:bg-destructive-900/30 dark:text-destructive-300"
                                : "border-tertiary-200 bg-tertiary-50 text-tertiary-700 dark:border-tertiary-800 dark:bg-tertiary-900/30 dark:text-tertiary-300",
                          )}
                        >
                          {sentimentData.overall ?? "N/A"}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    {sentimentData.details && (
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          {sentimentData.details}
                        </p>
                      </CardContent>
                    )}
                  </Card>
                )}
              </div>
            )}

            {/* Whiteboard — shown if any whiteboard messages exist */}
            {(() => {
              const whiteboardMsgs = summary.data?.messages.filter(
                (m: any) =>
                  m.contentType === "WHITEBOARD" && m.whiteboardImageUrl,
              );
              if (!whiteboardMsgs || whiteboardMsgs.length === 0) return null;
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <PenLine className="h-4 w-4" />
                      Whiteboard
                      <Badge variant="secondary" className="ml-1 font-normal">
                        {whiteboardMsgs.length}{" "}
                        {whiteboardMsgs.length === 1 ? "drawing" : "drawings"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {whiteboardMsgs.map((msg: any) => {
                        const label = (
                          msg.whiteboardData as Record<string, unknown> | null
                        )?.label as string | undefined;
                        const alt = label ?? "Whiteboard drawing";
                        return (
                          <button
                            key={msg.id}
                            type="button"
                            className="group overflow-hidden rounded-lg border bg-card p-1.5 text-left transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/30"
                            onClick={() =>
                              setLightboxImg({
                                src: msg.whiteboardImageUrl!,
                                alt,
                              })
                            }
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={msg.whiteboardImageUrl!}
                              alt={alt}
                              className="h-44 w-full rounded object-contain"
                            />
                            <div className="mt-1 flex items-center justify-between px-0.5">
                              {label && (
                                <p className="truncate text-[11px] font-medium text-muted-foreground">
                                  {label}
                                </p>
                              )}
                              <p className="ml-auto text-[10px] text-muted-foreground/60">
                                {new Date(msg.timestamp).toLocaleTimeString(
                                  undefined,
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            <ReportIntegrity data={report} sessionId={sessionId} />
            {strikeEvents.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Camera className="h-4 w-4 text-amber-600" /> Strike evidence
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {strikeEvents.map((v, i) => {
                      const label = STRIKE_LABEL[v.type] ?? v.type;
                      const reason = v.detail || label;
                      return (
                        <div key={`${v.timestamp}-${i}`} className="overflow-hidden rounded-md border">
                          {v.imageUrl ? (
                            <button
                              type="button"
                              className="block w-full"
                              onClick={() => setLightboxImg({ src: v.imageUrl!, alt: reason })}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={v.imageUrl}
                                alt={`Strike ${i + 1}: ${reason}`}
                                className="aspect-video w-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="flex aspect-video items-center justify-center bg-muted px-3 text-center text-xs text-muted-foreground">
                              No snapshot captured
                            </div>
                          )}
                          <div className="space-y-0.5 px-2 py-1.5 text-xs">
                            <p className="font-medium text-foreground">
                              Strike {i + 1}: {label}
                            </p>
                            <p className="text-muted-foreground">
                              {new Date(v.timestamp).toLocaleString()}
                              {v.detail && v.detail !== label ? ` · ${v.detail}` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Code Snippets */}
            {(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const codeMsgs = summary.data?.messages.filter(
                (m: any) => (m.contentType as string) === "CODE",
              );
              if (!codeMsgs || codeMsgs.length === 0) return null;
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Code2 className="h-4 w-4" />
                      Code Snippets
                      <Badge variant="secondary" className="ml-1 font-normal">
                        {codeMsgs.length}{" "}
                        {codeMsgs.length === 1 ? "snippet" : "snippets"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {codeMsgs.map((msg: any) => {
                      const data = msg.whiteboardData as Record<
                        string,
                        unknown
                      > | null;
                      const label = (data?.label as string) ?? "Code Snippet";
                      const code = (data?.code as string) ?? "";
                      const language =
                        (data?.language as string) ?? "plaintext";
                      return (
                        <div
                          key={msg.id}
                          className="overflow-hidden rounded-lg border bg-zinc-950"
                        >
                          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5">
                            <span className="text-xs font-medium text-zinc-200">
                              {label}
                            </span>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="border-zinc-700 text-[10px] font-normal text-zinc-400"
                              >
                                {getCodeLanguage(language)
                                  ? `${getCodeLanguage(language)!.label} ${getCodeLanguage(language)!.version}`
                                  : language}
                              </Badge>
                              <span className="text-[10px] text-zinc-500">
                                {new Date(msg.timestamp).toLocaleTimeString(
                                  undefined,
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </span>
                            </div>
                          </div>
                          <CodeBlock
                            code={code}
                            language={language}
                            className="text-sm"
                          />
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Audio Recording */}
            {summary.data?.audioRecordingUrl && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mic className="h-4 w-4" />
                    Audio Recording
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {!audioCanPlay && !audioFailed && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading recording…
                    </p>
                  )}
                  {audioFailed && (
                    <p className="text-xs text-destructive">
                      Recording file could not be played. Try opening it in a new tab or re-approve media review.
                    </p>
                  )}
                  <audio
                    controls
                    preload="auto"
                    src={summary.data.audioRecordingUrl}
                    className={cn("w-full", !audioCanPlay && !audioFailed && "opacity-50")}
                    onCanPlay={() => {
                      setAudioCanPlay(true);
                      setAudioFailed(false);
                    }}
                    onError={() => setAudioFailed(true)}
                  />
                </CardContent>
              </Card>
            )}
            {!summary.data?.audioRecordingUrl && !summary.data?.mediaClearedAt && summary.data?.status === "COMPLETED" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Mic className="h-4 w-4" />
                    Audio Recording
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    No recording was saved for this session. New interviews always capture mic + AI audio when the session ends cleanly.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Screenshots */}
            {(() => {
              const screenshots = summary.data?.screenshots as
                | {
                    url: string;
                    path: string;
                    timestamp: string;
                    type: "camera" | "screen";
                  }[]
                | null;
              if (!screenshots || screenshots.length === 0) return null;
              const cameraShots = screenshots.filter(
                (s) => s.type === "camera",
              );
              const screenShots = screenshots.filter(
                (s) => s.type === "screen",
              );
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Camera className="h-4 w-4" />
                      Interview Screenshots
                      <Badge variant="secondary" className="ml-1 font-normal">
                        {screenshots.length}{" "}
                        {screenshots.length === 1 ? "capture" : "captures"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {cameraShots.length > 0 && (
                      <div>
                        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                          <Camera className="h-3.5 w-3.5" />
                          Camera
                        </p>
                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                          {cameraShots.map((shot, i) => (
                            <button
                              key={i}
                              type="button"
                              className="group overflow-hidden rounded-lg border bg-card p-1 text-left transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/30"
                              onClick={() =>
                                setLightboxImg({
                                  src: shot.url,
                                  alt: `Camera screenshot at ${new Date(shot.timestamp).toLocaleTimeString()}`,
                                })
                              }
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={shot.url}
                                alt={`Camera at ${new Date(shot.timestamp).toLocaleTimeString()}`}
                                className="h-24 w-full rounded object-cover"
                              />
                              <p className="mt-0.5 text-center text-[10px] text-muted-foreground/60">
                                {new Date(shot.timestamp).toLocaleTimeString(
                                  undefined,
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {screenShots.length > 0 && (
                      <div>
                        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                          <Monitor className="h-3.5 w-3.5" />
                          Screen
                        </p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {screenShots.map((shot, i) => (
                            <button
                              key={i}
                              type="button"
                              className="group overflow-hidden rounded-lg border bg-card p-1 text-left transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/30"
                              onClick={() =>
                                setLightboxImg({
                                  src: shot.url,
                                  alt: `Screen screenshot at ${new Date(shot.timestamp).toLocaleTimeString()}`,
                                })
                              }
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={shot.url}
                                alt={`Screen at ${new Date(shot.timestamp).toLocaleTimeString()}`}
                                className="h-36 w-full rounded object-cover"
                              />
                              <p className="mt-0.5 text-center text-[10px] text-muted-foreground/60">
                                {new Date(shot.timestamp).toLocaleTimeString(
                                  undefined,
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Transcript — collapsible (forced open during PDF export) */}
            <Card>
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => setTranscriptOpen((prev) => !prev)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4" />
                    Transcript
                    <Badge variant="secondary" className="ml-1 font-normal">
                      {transcriptMessages.length} messages
                    </Badge>
                    {transcriptFromRecording && (
                      <span className="text-xs font-normal text-muted-foreground">
                        Candidate answers rebuilt from recording
                      </span>
                    )}
                  </CardTitle>
                  {!pdfCapture &&
                    (transcriptOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ))}
                </div>
              </CardHeader>
              {(transcriptOpen || pdfCapture) && (
                <CardContent>
                  <div className={pdfCapture ? "space-y-4" : ""}>
                    {transcriptMessages.length === 0 ? (
                      <p className="py-8 text-center text-muted-foreground">
                        No messages recorded for this session.
                      </p>
                    ) : (
                      <div
                        className={
                          pdfCapture
                            ? "space-y-4"
                            : "max-h-[min(70vh,900px)] space-y-4 overflow-y-auto pr-2 code-scrollbar"
                        }
                      >
                        {transcriptMessages.map((msg) => {
                          const isUser = msg.role === "USER";
                          const isChat = msg.transcription === "chat";
                          return (
                            <div
                              key={msg.id}
                              className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-lg px-4 py-2.5 ${
                                  isUser
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-secondary-100 dark:bg-secondary text-secondary-900 dark:text-secondary-foreground"
                                }`}
                              >
                                <div className="mb-1 flex items-center justify-between gap-3">
                                  <span
                                    className={`flex items-center gap-1 text-xs font-semibold ${isUser ? "text-primary-foreground/80" : "text-secondary-700 dark:text-secondary-300"}`}
                                  >
                                    {isUser ? (
                                      isChat ? (
                                        <MessageSquare className="h-3 w-3" />
                                      ) : (
                                        <Mic className="h-3 w-3" />
                                      )
                                    ) : (
                                      <Volume2 className="h-3 w-3" />
                                    )}
                                    {isUser ? "Participant" : "Interviewer"}
                                  </span>
                                  <span
                                    className={`shrink-0 text-[10px] ${isUser ? "text-primary-foreground/60" : "text-secondary-600 dark:text-secondary-400"}`}
                                  >
                                    {formatMsgTime(msg.timestamp)}
                                  </span>
                                </div>
                                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                                  {msg.content}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        </>
      )}

      <PdfBuilderDialog
        open={pdfBuilderOpen}
        onOpenChange={setPdfBuilderOpen}
        data={report}
        organizationId={(summary.data as { organizationId?: string } | undefined)?.organizationId ?? currentOrg?.id}
        sessionId={sessionId}
      />

      {/* End interview confirmation for in-progress sessions */}
      <AlertDialog open={showEndConfirm} onOpenChange={setShowEndConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              End interview and generate report?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This interview is still in progress. Generating the report will
              end the interview — the candidate will no longer be able to
              continue. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmEndAndGenerate}>
              End Interview & Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRetranscribeConfirm} onOpenChange={setShowRetranscribeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-transcribe from recording?</AlertDialogTitle>
            <AlertDialogDescription>
              The candidate&apos;s spoken answers will be rebuilt from the recording and the
              report will be generated again. Interviewer lines and typed answers stay as they
              are. This can take a few minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRetranscribe}>Re-transcribe</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lightbox overlay for whiteboard drawings */}
      {lightboxImg && (
        <div
          className="!m-0 fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxImg(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            onClick={() => setLightboxImg(null)}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxImg.src}
            alt={lightboxImg.alt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
