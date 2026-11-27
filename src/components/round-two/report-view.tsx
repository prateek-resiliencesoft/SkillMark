"use client";

import { RecommendationBadge } from "@/components/round-two/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoundTwoReport, StyleMetrics } from "@/lib/round-two/types";

function StyleRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr className="border-t">
      <td className="py-1.5 pr-3 text-muted-foreground">{label}</td>
      <td className="py-1.5 pr-3">{a}</td>
      <td className="py-1.5">{b}</td>
    </tr>
  );
}

export function StyleTable({ r1, r2 }: { r1: StyleMetrics | null; r2: StyleMetrics | null }) {
  const f = (m: StyleMetrics | null, k: keyof StyleMetrics, pct = false) => {
    const v = m?.[k];
    if (v == null) return "—";
    return pct ? `${(Number(v) * 100).toFixed(1)}%` : String(v);
  };
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="pb-1 font-medium" />
          <th className="pb-1 font-medium">Round 1</th>
          <th className="pb-1 font-medium">Round 2</th>
        </tr>
      </thead>
      <tbody>
        <StyleRow label="Words per answer" a={f(r1, "avgWordsPerAnswer")} b={f(r2, "avgWordsPerAnswer")} />
        <StyleRow label="Speaking rate (wpm)" a={f(r1, "wordsPerMinute")} b={f(r2, "wordsPerMinute")} />
        <StyleRow label="Filler words" a={f(r1, "fillerRatio", true)} b={f(r2, "fillerRatio", true)} />
        <StyleRow label="Vocabulary variety" a={f(r1, "lexicalDiversity")} b={f(r2, "lexicalDiversity")} />
      </tbody>
    </table>
  );
}

const avg = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));

export function RoundTwoReportView({ report }: { report: RoundTwoReport }) {
  const b = report.scoreBreakdown;
  const notes = report.basis?.notes ?? [];
  return (
    <div className="space-y-4">
      {notes.length > 0 && !report.insufficientEvidence && (
        <div className="rounded-lg border border-amber-600/40 bg-amber-600/5 p-3 text-sm">
          {notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          {report.insufficientEvidence ? (
            <div className="rounded-md border border-amber-600/40 bg-amber-600/5 px-3 py-2 text-sm font-medium">Not enough data to score</div>
          ) : (
            <>
              <div>
                <div className="text-3xl font-bold">{report.overallScore.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">out of 10</div>
              </div>
              <div className="space-y-1">
                <RecommendationBadge value={report.recommendation} />
                <div className="text-xs text-muted-foreground">Confidence {(report.confidence * 100).toFixed(0)}%</div>
              </div>
            </>
          )}
          <p className="min-w-[260px] flex-1 text-sm">{report.summary}</p>
        </CardContent>
        {b && (b.questions != null || b.criteria != null || b.coding != null) && (
          <CardContent className="flex flex-wrap gap-x-6 gap-y-1 border-t px-5 py-3 text-xs text-muted-foreground">
            <span>Questions avg <strong className="text-foreground">{avg(b.questions)}</strong></span>
            <span>Skills avg <strong className="text-foreground">{avg(b.criteria)}</strong></span>
            <span>Coding avg <strong className="text-foreground">{avg(b.coding)}</strong></span>
            <span>Panel scorecards weigh heavily in the overall score.</span>
          </CardContent>
        )}
      </Card>

      {!!report.criteriaEvaluations?.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Skills</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.criteriaEvaluations.map((c) => (
              <div key={c.name} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{c.name}</span>
                  <span className="font-semibold tabular-nums">{c.score.toFixed(1)}/10</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, c.score * 10))}%` }} />
                </div>
                {c.reasoning && <p className="mt-1 text-xs text-muted-foreground">{c.reasoning}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Strengths</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {report.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Concerns</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {report.concerns.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            Questions
            {report.evidenceCheck && report.evidenceCheck.verified + report.evidenceCheck.unverified > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {report.evidenceCheck.verified} of {report.evidenceCheck.verified + report.evidenceCheck.unverified} quotes found in the transcript
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {report.questions.map((q, i) => (
            <div key={i} className="border-b pb-3 last:border-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{q.question}</p>
                <span className="shrink-0 text-sm font-semibold">{q.score.toFixed(1)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{q.answerSummary}</p>
              {(q.highlights?.length || q.improvements?.length) ? (
                <div className="mt-1 grid gap-x-4 text-xs sm:grid-cols-2">
                  {!!q.highlights?.length && (
                    <ul className="list-disc pl-4 text-emerald-700 dark:text-emerald-400">
                      {q.highlights.map((h, j) => (
                        <li key={j}>{h}</li>
                      ))}
                    </ul>
                  )}
                  {!!q.improvements?.length && (
                    <ul className="list-disc pl-4 text-amber-700 dark:text-amber-400">
                      {q.improvements.map((h, j) => (
                        <li key={j}>{h}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
              {q.evidence && (
                <p className="mt-1 border-l-2 pl-2 text-xs italic text-muted-foreground">
                  {q.evidence}
                  {q.evidenceVerified === false && <span className="ml-1.5 not-italic text-amber-600">(not found in transcript)</span>}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {!!report.codeEvaluations?.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Coding (shared editor)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report.codeEvaluations.map((c) => (
              <div key={c.snippetId} className="rounded-lg border p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.snippetLabel}</span>
                  <span className="rounded border px-1.5 text-xs text-muted-foreground">{c.language}</span>
                  <span className="text-xs text-muted-foreground">{c.submitted === false ? "Not submitted" : "Submitted ✓"}</span>
                  <span className="ml-auto text-xs font-semibold tabular-nums">{c.score}/10</span>
                </div>
                {c.question && <p className="mb-1 text-xs text-muted-foreground">{c.question}</p>}
                {c.evaluation && <p>{c.evaluation}</p>}
                {c.whatWentWrong.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                    {c.whatWentWrong.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                {c.expectedApproach && (
                  <p className="mt-1 text-xs">
                    <span className="font-semibold">Expected approach:</span> {c.expectedApproach}
                  </p>
                )}
                {c.referenceCode && (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Reference solution</summary>
                    <pre className="mt-1 overflow-auto rounded bg-muted p-2">{c.referenceCode}</pre>
                  </details>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!!report.whiteboardEvaluations?.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Whiteboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.whiteboardEvaluations.map((w) => (
              <div key={w.taskId} className="flex items-start justify-between gap-3">
                <span>
                  <span className="font-medium">{w.label}</span>
                  <span className="block text-xs text-muted-foreground">{w.observation}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums">{w.score != null ? `${w.score}/10` : "not scored"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(!!report.themes?.length || !!report.keyInsights?.length || !!report.notableQuotes?.length || report.sentiment || report.toneAnalysis) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Insights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!!report.themes?.length && (
              <div className="flex flex-wrap gap-1.5">
                {report.themes.map((t) => (
                  <span key={t} className="rounded-full border px-2 py-0.5 text-xs">{t}</span>
                ))}
              </div>
            )}
            {(report.sentiment || report.toneAnalysis) && (
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                {report.sentiment && (
                  <p><span className="font-semibold">Sentiment: {report.sentiment.overall}.</span> {report.sentiment.details}</p>
                )}
                {report.toneAnalysis && (
                  <p><span className="font-semibold">Tone: {report.toneAnalysis.overall}.</span> {report.toneAnalysis.details}</p>
                )}
              </div>
            )}
            {!!report.keyInsights?.length && (
              <ul className="list-disc space-y-1 pl-4">
                {report.keyInsights.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            )}
            {!!report.notableQuotes?.length && (
              <div className="space-y-1">
                {report.notableQuotes.map((q, i) => (
                  <p key={i} className="border-l-2 pl-2 text-xs italic text-muted-foreground">&ldquo;{q}&rdquo;</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Round 1 vs round 2 · {report.round1Comparison.consistency}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.round1Comparison.notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
            {report.round1Comparison.contradictions.map((c, i) => (
              <div key={i} className="rounded-md border border-amber-600/40 bg-amber-600/5 p-2 text-xs">
                <div>
                  <span className="font-semibold">Round 1:</span> {c.round1}
                </div>
                <div>
                  <span className="font-semibold">Round 2:</span> {c.round2}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Speaking style (signals only)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <StyleTable r1={report.style.round1} r2={report.style.round2} />
            {report.style.notes.map((n, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {n}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>

      {report.panel.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Panel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {report.panel.map((p, i) => (
              <div key={i} className="flex flex-wrap items-start gap-3 text-sm">
                <span className="font-medium">{p.name}</span>
                <RecommendationBadge value={p.recommendation} />
                {p.overallRating ? <span className="text-xs tabular-nums">{p.overallRating}/5</span> : null}
                {p.strengths && <span className="w-full text-xs"><span className="font-semibold">Strengths:</span> {p.strengths}</span>}
                {p.concerns && <span className="w-full text-xs"><span className="font-semibold">Concerns:</span> {p.concerns}</span>}
                {p.comments && <span className="text-muted-foreground">{p.comments}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!!report.integrity?.notes.length && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Integrity and evidence</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {report.integrity.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            {report.basis && (
              <p className="mt-2 text-xs text-muted-foreground">
                Built from the {report.basis.transcript === "none" ? "tasks and panel input (no transcript)" : `${report.basis.transcript} transcript`}: {report.basis.transcriptLines} lines, {report.basis.candidateWords} candidate words, {report.basis.tasksSubmitted} of {report.basis.tasksGiven} task(s) submitted.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
