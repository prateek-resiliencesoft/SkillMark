"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { useProject } from "@/components/project-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BklitStatCard } from "@/components/dashboard/bklit-stat-card";
import { BklitAreaChart } from "@/components/dashboard/bklit-area-chart";
import { BklitRadialGauge } from "@/components/dashboard/bklit-radial-gauge";
import { BklitFunnel } from "@/components/dashboard/bklit-funnel";
import { trpc } from "@/lib/trpc/client";
import {
  Hugeicon,
  createHugeicon,
  MessageSquareIcon,
  UserMultiple02Icon,
  Timer01Icon,
  ClipboardListIcon,
  ArrowRight01Icon,
  PlusSignIcon,
  Loading03Icon,
  Link01Icon,
  LockIcon,
} from "@/components/ui/hugeicon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PieChart, PieSlice, PieCenter, type PieData } from "@bklitui/ui/charts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

const PIE_COLORS = [
  "#5941F2", // electric violet
  "#296CF2", // azure
  "#277FF2", // cerulean
  "#0511F2", // cobalt
  "#8B5CF6", // purple
  "#06B6D4", // cyan
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const router = useRouter();
  const { currentProject } = useProject();
  const { locale, t } = useAppLocale();
  const projectId = currentProject?.id;
  const [creatingNew, setCreatingNew] = useState(false);
  const { data, isLoading } = trpc.interview.dashboardStats.useQuery(
    { projectId: projectId ?? undefined },
    { enabled: !!projectId },
  );
  const interviews = trpc.interview.list.useQuery(
    { limit: 5, projectId: projectId ?? undefined },
    { enabled: !!projectId },
  );

  // Derive sparkline points from 30-day daily points (take last 7 days)
  const sparklines = useMemo(() => {
    if (!data?.daily || data.daily.length === 0) {
      return {
        interviews: [],
        sessions: [],
        duration: [],
        questions: [],
      };
    }
    const last7 = data.daily.slice(-7);
    const getValues = (key: keyof (typeof last7)[0]) => {
      return last7.map((d) => Number(d[key]) || 0);
    };
    return {
      interviews: getValues("interviews"),
      sessions: getValues("sessions"),
      duration: getValues("sessionMinutes"),
      questions: getValues("questions"),
    };
  }, [data?.daily]);

  // Derive real average candidate score for Radial Gauge
  const avgCandidateScore = useMemo(() => {
    const scoredSessions =
      data?.recentSessions?.filter((s) => typeof s.score === "number" && s.score > 0) ?? [];
    if (scoredSessions.length === 0) return 0;
    const sum = scoredSessions.reduce((acc, curr) => acc + (curr.score ?? 0), 0);
    return Math.round((sum / scoredSessions.length) * 10) / 10;
  }, [data?.recentSessions]);

  const totalEvaluated = useMemo(() => {
    return data?.recentSessions?.filter((s) => typeof s.score === "number" && s.score > 0).length ?? 0;
  }, [data?.recentSessions]);

  const completionRate = useMemo(() => {
    const total = data?.totalSessions ?? 0;
    if (total === 0) return 0;
    const completed = data?.statusBreakdown.COMPLETED ?? 0;
    return Math.round((completed / total) * 100);
  }, [data?.totalSessions, data?.statusBreakdown]);

  // Funnel data from real candidate numbers
  const funnelStages = useMemo(() => {
    const totalSessions = data?.totalSessions ?? 0;
    const completed = data?.statusBreakdown.COMPLETED ?? 0;
    const inProgress = data?.statusBreakdown.IN_PROGRESS ?? 0;
    const notStarted = data?.statusBreakdown.NOT_STARTED ?? 0;
    const scored = data?.recentSessions?.filter((s) => typeof s.score === "number" && s.score > 0).length ?? 0;

    return [
      { name: "Invited Candidates", count: totalSessions + notStarted, color: "#0511F2" },
      { name: "Sessions Commenced", count: totalSessions, color: "#296CF2" },
      { name: "Active Assessment", count: completed + inProgress, color: "#277FF2" },
      { name: "Completed Interviews", count: completed, color: "#5941F2" },
      { name: "AI Evaluated & Scored", count: scored, color: "#8B5CF6" },
    ];
  }, [data]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
            {t("dashboard.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t("dashboard.subtitle")}
          </p>
        </div>
        <Button
          data-tour="new-interview"
          disabled={creatingNew}
          onClick={() => {
            setCreatingNew(true);
            router.push("/interviews/new");
          }}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm"
        >
          {creatingNew ? (
            <Hugeicon icon={Loading03Icon} className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Hugeicon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
          )}
          {t("sidebar.newInterview")}
        </Button>
      </div>

      {/* Row 1: Bklit Stat Cards with dynamic Sparklines */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BklitStatCard
          title={t("dashboard.totalInterviews")}
          value={data?.totalInterviews}
          icon={createHugeicon(MessageSquareIcon)}
          sparklineData={sparklines.interviews}
          accentColor="#5941F2"
          subtitle="pipeline active"
          loading={isLoading}
        />
        <BklitStatCard
          title={t("dashboard.totalSessions")}
          value={data?.totalSessions}
          icon={createHugeicon(UserMultiple02Icon)}
          sparklineData={sparklines.sessions}
          accentColor="#296CF2"
          subtitle="candidates"
          loading={isLoading}
        />
        <BklitStatCard
          title={t("dashboard.totalDuration")}
          value={data ? formatDuration(data.totalDuration) : undefined}
          icon={createHugeicon(Timer01Icon)}
          sparklineData={sparklines.duration}
          accentColor="#277FF2"
          subtitle="assessment time"
          loading={isLoading}
        />
        <BklitStatCard
          title={t("dashboard.totalQuestions")}
          value={data?.totalQuestions}
          icon={createHugeicon(ClipboardListIcon)}
          sparklineData={sparklines.questions}
          accentColor="#0511F2"
          subtitle="in active bank"
          loading={isLoading}
        />
      </div>

      {/* Row 2: Bklit Area Chart (30-day Time Series) + Radial Performance Gauge */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <BklitAreaChart
            title="Interview Activity & Volume"
            subtitle="Candidate session count, duration minutes, and AI interactions"
            data={data?.daily ?? []}
            loading={isLoading}
          />
        </div>
        <div className="lg:col-span-5">
          <BklitRadialGauge
            score={avgCandidateScore}
            completionRate={completionRate}
            totalEvaluated={totalEvaluated}
            loading={isLoading}
          />
        </div>
      </div>

      {/* Row 3: Bklit Candidate Funnel & Session/Question Breakdowns */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <BklitFunnel
            stages={funnelStages}
            loading={isLoading}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          <PieCard
            title={t("dashboard.sessionStatus")}
            centerLabel={t("dashboard.totalSessionsLabel")}
            data={[
              {
                name: t("dashboard.completed"),
                value: data?.statusBreakdown.COMPLETED ?? 0,
              },
              {
                name: t("dashboard.inProgress"),
                value: data?.statusBreakdown.IN_PROGRESS ?? 0,
              },
              {
                name: t("dashboard.notStarted"),
                value: data?.statusBreakdown.NOT_STARTED ?? 0,
              },
            ]}
            loading={isLoading}
          />
          <PieCard
            title={t("dashboard.questionType")}
            centerLabel={t("dashboard.totalQuestionsLabel")}
            data={[
              {
                name: t("dashboard.openEnded"),
                value: data?.questionTypeBreakdown.OPEN_ENDED ?? 0,
              },
              {
                name: t("dashboard.singleChoice"),
                value: data?.questionTypeBreakdown.SINGLE_CHOICE ?? 0,
              },
              {
                name: t("dashboard.multipleChoice"),
                value: data?.questionTypeBreakdown.MULTIPLE_CHOICE ?? 0,
              },
              {
                name: t("dashboard.coding"),
                value: data?.questionTypeBreakdown.CODING ?? 0,
              },
              {
                name: t("dashboard.whiteboard"),
                value: data?.questionTypeBreakdown.WHITEBOARD ?? 0,
              },
              {
                name: t("dashboard.research"),
                value: data?.questionTypeBreakdown.RESEARCH ?? 0,
              },
            ]}
            loading={isLoading}
          />
        </div>
      </div>

      {/* Row 4: Top Competency Themes */}
      <ThemesCard
        themes={data?.topThemes ?? []}
        loading={isLoading}
        title={t("dashboard.topThemes")}
        emptyLabel={t("dashboard.noData")}
      />

      {/* Row 5: Recent Completed Sessions */}
      {(data?.recentSessions.length ?? 0) > 0 && (
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="font-heading text-lg font-bold">
                {t("dashboard.recentSessions")}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Verified candidate assessments and evaluation scores
              </p>
            </div>
            <Link href="/candidates">
              <Button variant="ghost" size="sm" className="text-xs">
                {t("common.viewAll")}{" "}
                <Hugeicon icon={ArrowRight01Icon} className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data?.recentSessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/interviews/${s.interviewId}/results?session=${s.id}`}
                  className="group flex flex-col gap-2 rounded-xl border border-border/50 p-3.5 transition-all duration-200 hover:border-primary/40 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-bold text-primary shadow-xs">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {s.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.date).toLocaleDateString(
                          locale === "zh" ? "zh-CN" : "en-US",
                          { day: "numeric", month: "short", year: "numeric" },
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-medium">
                    {s.score !== null && <ScoreBadge score={s.score} />}
                    <span className="text-muted-foreground">
                      {t("dashboard.messagesShort", { count: s.messages })}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDuration(s.duration)}
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 6: Recent Interviews */}
      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="font-heading text-lg font-bold">
              {t("dashboard.recentInterviews")}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configured interview templates and live assessment links
            </p>
          </div>
          <Link href="/interviews">
            <Button variant="ghost" size="sm" className="text-xs">
              {t("common.viewAll")}{" "}
              <Hugeicon icon={ArrowRight01Icon} className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {interviews.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : interviews.data?.interviews.length === 0 ? (
            <div className="py-12 text-center">
              <Hugeicon icon={MessageSquareIcon} className="mx-auto h-12 w-12 text-muted-foreground/40" />
              <h3 className="mt-4 font-heading text-base font-semibold">
                {t("dashboard.noInterviews")}
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1">
                {t("dashboard.createFirstInterview")}
              </p>
              <Link href="/interviews/new" className="mt-4 inline-block">
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                  <Hugeicon icon={PlusSignIcon} className="mr-2 h-4 w-4" />
                  {t("dashboard.createInterview")}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {interviews.data?.interviews.map((interview) => (
                <Link
                  key={interview.id}
                  href={`/interviews/${interview.id}/edit`}
                  className="group flex flex-col gap-2 rounded-xl border border-border/50 p-3.5 transition-all duration-200 hover:border-primary/40 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                      {interview.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {interview._count.questions}{" "}
                      {t("dashboard.questions").toLowerCase()} &middot;{" "}
                      {interview._count.sessions}{" "}
                      {t("sidebar.sessions").toLowerCase()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {interview.publicSlug &&
                    interview.isActive &&
                    !interview.requireInvite ? (
                      <Badge
                        variant="outline"
                        className="gap-1 max-w-[200px] border-primary/30 bg-primary/5 text-primary text-xs"
                      >
                        <Hugeicon icon={Link01Icon} className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          /i/{interview.publicSlug}
                        </span>
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Hugeicon icon={LockIcon} className="h-3 w-3" />
                        {t("dashboard.inviteOnly")}
                      </Badge>
                    )}
                    {interview.chatEnabled && (
                      <Badge variant="outline" className="text-xs">{t("dashboard.chat")}</Badge>
                    )}
                    {interview.voiceEnabled && (
                      <Badge variant="outline" className="text-xs">{t("dashboard.voice")}</Badge>
                    )}
                    {interview.videoEnabled && (
                      <Badge variant="outline" className="text-xs">{t("dashboard.video")}</Badge>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PieCard({
  title,
  centerLabel,
  data,
  loading,
}: {
  title: string;
  centerLabel: string;
  data: { name: string; value: number }[];
  loading: boolean;
}) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chartData: PieData[] = useMemo(
    () =>
      data
        .filter((d) => d.value > 0)
        .map((d, idx) => ({
          label: d.name,
          value: d.value,
          color: PIE_COLORS[idx % PIE_COLORS.length],
        })),
    [data]
  );

  const hoveredItem =
    hoveredIndex !== null && chartData[hoveredIndex]
      ? chartData[hoveredIndex]
      : null;

  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="pb-1">
        <CardTitle className="font-heading text-base font-bold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pb-5">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center space-y-4">
            <div className="relative flex h-40 w-40 items-center justify-center">
              <Skeleton className="h-40 w-40 rounded-full" />
              <div className="absolute h-24 w-24 rounded-full bg-card" />
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Skeleton className="h-5 w-20 rounded-md" />
              <Skeleton className="h-5 w-20 rounded-md" />
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
          </div>
        ) : total === 0 ? (
          <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
            No data yet
          </div>
        ) : (
          <div>
            <div className="relative flex items-center justify-center py-2">
              <PieChart
                data={chartData}
                size={210}
                innerRadius={64}
                padAngle={0.03}
                cornerRadius={6}
                hoverOffset={8}
                hoveredIndex={hoveredIndex}
                onHoverChange={setHoveredIndex}
              >
                {chartData.map((_, index) => (
                  <PieSlice
                    key={index}
                    index={index}
                    showGlow
                    hoverEffect="translate"
                  />
                ))}
                <PieCenter defaultLabel={centerLabel}>
                  {({ value, label, isHovered }) => (
                    <div className="flex flex-col items-center justify-center text-center px-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 max-w-[110px] truncate">
                        {label}
                      </span>
                      <span className="font-heading text-2xl font-extrabold text-foreground tracking-tight">
                        {value.toLocaleString()}
                      </span>
                      {total > 0 && (
                        <span className="text-[10px] font-semibold text-primary">
                          {isHovered
                            ? `${Math.round((value / total) * 100)}%`
                            : `${total} Total`}
                        </span>
                      )}
                    </div>
                  )}
                </PieCenter>
              </PieChart>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              {data.map((d, originalIdx) => {
                const chartIdx = chartData.findIndex((c) => c.label === d.name);
                const isHovered = hoveredItem?.label === d.name;
                const isDimmed = hoveredItem !== null && !isHovered;
                const color =
                  chartIdx >= 0
                    ? chartData[chartIdx].color
                    : PIE_COLORS[originalIdx % PIE_COLORS.length];

                return (
                  <button
                    key={d.name}
                    type="button"
                    onMouseEnter={() => {
                      if (chartIdx >= 0) setHoveredIndex(chartIdx);
                    }}
                    onMouseLeave={() => {
                      if (chartIdx >= 0) setHoveredIndex(null);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-all duration-200",
                      isHovered
                        ? "bg-accent text-accent-foreground font-semibold shadow-xs scale-105"
                        : isDimmed
                          ? "opacity-45 hover:opacity-100"
                          : "hover:bg-muted/60"
                    )}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full shrink-0 transition-transform duration-200"
                      style={{
                        backgroundColor: color,
                        transform: isHovered ? "scale(1.25)" : "scale(1)",
                      }}
                    />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-semibold text-foreground ml-0.5">
                      {d.value}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ThemesCard({
  themes,
  loading,
  title,
  emptyLabel,
}: {
  themes: { theme: string; count: number }[];
  loading: boolean;
  title: string;
  emptyLabel: string;
}) {
  const maxCount = themes.length > 0 ? themes[0].count : 1;

  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-heading text-base font-bold">{title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Most tested skills & core competency clusters across candidates
            </p>
          </div>
          <span className="text-xs font-semibold text-primary">
            {themes.length} topics tracked
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24 rounded" />
                  <Skeleton className="h-4 w-6 rounded-full" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : themes.length === 0 ? (
          <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {themes.map((t) => (
              <div key={t.theme} className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="truncate font-semibold text-foreground">
                    {t.theme}
                  </span>
                  <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    {t.count}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-[#296CF2] transition-all duration-500"
                    style={{ width: `${(t.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 7.5
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
      : score >= 5.0
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
        : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${color}`}>
      {score.toFixed(1)}/10
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    COMPLETED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    IN_PROGRESS: "bg-[#296CF2]/10 text-[#296CF2] border-[#296CF2]/20",
    NOT_STARTED: "bg-muted text-muted-foreground border-border",
  };
  const labels: Record<string, string> = {
    COMPLETED: "Completed",
    IN_PROGRESS: "In Progress",
    NOT_STARTED: "Not Started",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles[status] ?? "bg-muted text-muted-foreground border-border"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
