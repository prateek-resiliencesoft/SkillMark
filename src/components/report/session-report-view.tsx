"use client";

import {
  CountUp,
  ExpandableText,
  RecommendationBadge,
  Reveal,
  ScoreBar,
  ScoreChip,
  ScoreGauge,
  StatTile,
} from "@/components/report/report-visuals";
import { SessionErrorLogButton } from "@/components/session/session-error-log";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "@/lib/report-data";
import { scoreColor, toBullets } from "@/lib/report-data";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  HelpCircle,
  MessageSquareQuote,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

/** Hero: candidate, animated overall gauge, recommendation and key stat tiles. */
export function ReportHero({ data }: { data: ReportData }) {
  const strikeTone = data.disqualified ? "danger" : data.integrityStrikes > 0 ? "warn" : "default";
  return (
    <Reveal>
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/10 via-background to-background">
          <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
            <div className="flex flex-1 items-center gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-background bg-muted shadow ring-2 ring-primary/20">
                {data.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.avatarUrl} alt={data.participantName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-bold text-muted-foreground">
                    {data.participantName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {data.title} · Session report
                </p>
                <h1 className="truncate text-2xl font-bold">{data.participantName}</h1>
                <div className="flex flex-wrap items-center gap-2">
                  {data.recommendation && <RecommendationBadge value={data.recommendation} />}
                  {data.status && (
                    <Badge variant={data.status === "COMPLETED" ? "default" : "secondary"}>{data.status}</Badge>
                  )}
                </div>
                {data.objective && (
                  <ExpandableText text={`Objective: ${data.objective}`} lines={1} className="text-xs text-muted-foreground" />
                )}
              </div>
            </div>
            {data.overallScore !== null && (
              <div className="flex flex-col items-center">
                <ScoreGauge score={Number(data.overallScore.toFixed(1))} />
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Overall score</p>
              </div>
            )}
          </CardContent>
          <div className="grid grid-cols-2 gap-3 px-6 pb-6 md:grid-cols-4">
            <StatTile
              icon={<Clock className="h-4 w-4" />}
              label="Duration"
              value={data.durationMinutes != null ? <><CountUp value={data.durationMinutes} /> min</> : "—"}
            />
            <StatTile
              icon={<HelpCircle className="h-4 w-4" />}
              label="Questions answered"
              value={<CountUp value={data.questionsAnswered} />}
            />
            <StatTile
              icon={data.integrityStrikes ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              label="Integrity strikes"
              tone={strikeTone}
              value={<>{data.integrityStrikes}<span className="text-sm font-medium text-muted-foreground"> / {data.maxStrikes}</span></>}
            />
            <StatTile
              icon={<CalendarDays className="h-4 w-4" />}
              label="Date"
              value={
                <span className="text-base">
                  {data.createdAt ? new Date(data.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}
                </span>
              }
            />
          </div>
        </div>
      </Card>
    </Reveal>
  );
}

export function ReportSummary({ data }: { data: ReportData }) {
  if (!data.summary) return null;
  const bullets = toBullets(data.summary, 5);
  return (
    <Reveal>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" /> Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {bullets.length > 1 ? (
            <ul className="space-y-2">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ExpandableText text={data.summary} className="text-sm" />
          )}
          {bullets.length > 1 && toBullets(data.summary, 99).length > bullets.length && (
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer text-xs font-medium text-primary">Read full summary</summary>
              <p className="mt-2 whitespace-pre-line leading-relaxed">{data.summary}</p>
            </details>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}

/** Competencies: radar (3+ criteria) next to animated colour-coded bars. */
export function ReportSkills({ data }: { data: ReportData }) {
  const reduce = useReducedMotion();
  if (data.criteria.length === 0) return null;
  const radar = data.criteria.length >= 3;
  return (
    <Reveal>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" /> Skills &amp; competencies
          </CardTitle>
        </CardHeader>
        <CardContent className={cn("grid gap-6", radar && "lg:grid-cols-2")}>
          {radar && (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={data.criteria.map((c) => ({ name: c.name.length > 18 ? `${c.name.slice(0, 17)}…` : c.name, score: c.score }))} outerRadius="72%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                  <Radar
                    dataKey="score"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.25}
                    isAnimationActive={!reduce}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="space-y-4">
            {data.criteria.map((c, i) => (
              <ScoreBar key={i} label={c.name} score={c.score} hint={c.reasoning} />
            ))}
          </div>
        </CardContent>
      </Card>
    </Reveal>
  );
}

export function ReportStrengths({ data }: { data: ReportData }) {
  if (data.strengths.length === 0 && data.concerns.length === 0) return null;
  const col = (title: string, items: string[], good: boolean) => (
    <Card className={cn("h-full", good ? "border-green-200 dark:border-green-900" : "border-amber-200 dark:border-amber-900")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {good ? <ThumbsUp className="h-4 w-4 text-green-600" /> : <TriangleAlert className="h-4 w-4 text-amber-600" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing notable.</p>}
        {items.map((s, i) => (
          <Reveal key={i} delay={i * 0.05}>
            <div
              className={cn(
                "flex gap-2.5 rounded-lg p-2.5 text-sm",
                good ? "bg-green-50 dark:bg-green-950/20" : "bg-amber-50 dark:bg-amber-950/20",
              )}
            >
              {good ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              )}
              <ExpandableText text={s} lines={2} />
            </div>
          </Reveal>
        ))}
      </CardContent>
    </Card>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {col("Strengths", data.strengths, true)}
      {col("Concerns", data.concerns, false)}
    </div>
  );
}

export function ReportQuestions({ data }: { data: ReportData }) {
  const [open, setOpen] = useState<number | null>(0);
  const reduce = useReducedMotion();
  if (data.questions.length === 0) return null;
  return (
    <Reveal>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-4 w-4 text-primary" /> Question by question
            <Badge variant="secondary" className="ml-1 font-normal">{data.questions.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.questions.map((q, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="overflow-hidden rounded-lg border">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: scoreColor(q.score) }}
                    aria-hidden
                  />
                  <span className="flex-1 text-sm font-medium">
                    <span className="text-muted-foreground">Q{q.index}.</span> {q.question}
                  </span>
                  <ScoreChip score={q.score} />
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="space-y-3 border-t bg-muted/20 px-4 py-3">
                        {q.answerExcerpt && (
                          <div className="flex gap-2 rounded-md border-l-2 border-primary/40 bg-background p-3 text-sm italic text-muted-foreground">
                            <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 not-italic text-primary" />
                            <span>“{q.answerExcerpt}”</span>
                          </div>
                        )}
                        {q.evaluation && (
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI feedback</p>
                            <ExpandableText text={q.evaluation} className="text-sm" />
                          </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                          {q.highlights.length > 0 && (
                            <ul className="space-y-1">
                              {q.highlights.map((h, j) => (
                                <li key={j} className="flex gap-1.5 text-xs">
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" /> {h}
                                </li>
                              ))}
                            </ul>
                          )}
                          {q.improvements.length > 0 && (
                            <ul className="space-y-1">
                              {q.improvements.map((h, j) => (
                                <li key={j} className="flex gap-1.5 text-xs">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> {h}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </Reveal>
  );
}

/** Integrity / anti-cheat overview with strike meter and link to the error log. */
export function ReportIntegrity({ data, sessionId }: { data: ReportData; sessionId: string }) {
  const clean = data.integrityStrikes === 0 && !data.disqualified;
  return (
    <Reveal>
      <Card className={cn(data.disqualified ? "border-red-300 dark:border-red-900" : !clean && "border-amber-200 dark:border-amber-900")}>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {clean ? <ShieldCheck className="h-4 w-4 text-green-600" /> : <ShieldAlert className="h-4 w-4 text-amber-600" />}
            Integrity &amp; anti-cheat
            <span className="ml-auto"><SessionErrorLogButton sessionId={sessionId} /></span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.disqualified && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              Disqualified: the interview ended automatically after {data.maxStrikes} anti-cheating strikes.
            </div>
          )}
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span>Strikes</span>
              <span>{data.integrityStrikes} of {data.maxStrikes}</span>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: data.maxStrikes }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-2.5 flex-1 rounded-full",
                    i < data.integrityStrikes ? (data.disqualified ? "bg-red-500" : "bg-amber-500") : "bg-muted",
                  )}
                />
              ))}
            </div>
          </div>
          {clean ? (
            <p className="text-sm text-muted-foreground">No integrity events were recorded during this interview.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.integrity.map((e) => (
                <span key={e.label} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  {e.label}
                  <span className="rounded-full bg-amber-200/70 px-1.5 font-semibold dark:bg-amber-900/60">{e.count}</span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Reveal>
  );
}
