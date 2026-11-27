/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { latestTimestamp, timeRangeCutoff } from "@/lib/time-range";
import { listDurationSeconds } from "@/lib/session-activity";
import { livePollInterval } from "@/lib/live-poll";
import { useAppLocale } from "@/components/app-locale-provider";
import { useProject } from "@/components/project-provider";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { exportToXlsx } from "@/lib/export-xlsx";
import { getSessionOverallScore } from "@/lib/session-score";
import { ScoreWithBreakdown } from "@/components/session/score-with-breakdown";
import { formatSessionStatusLabel } from "@/lib/preflight";
import { cleanInterviewTitle } from "@/lib/documents/candidate-name";
import { resolveJobRole } from "@/lib/job-role";
import { QuitEarlyBadge } from "@/components/candidates/quit-early-badge";
import { decisionStatusLabel } from "@/lib/candidate-decision";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Calendar,
    CalendarClock,
    Check,
    ChevronLeft,
    ChevronRight,
    CircleDot,
    Download,
    ExternalLink,
    Pencil,
    GripVertical,
    Loader2,
    Search,
    Settings,
    Trash2,
    X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CandidateDetailSheet } from "@/components/candidates/candidate-detail-sheet";
import { ExpiredBadge, ExtendExpiryDialog } from "@/components/candidates/extend-expiry-dialog";
import { LeftFollowupAction } from "@/components/candidates/left-followup-action";
import { leftFollowupState } from "@/lib/left-followup";
import { isLinkExpired } from "@/lib/session-link";
import { RoundFilterSegments } from "@/components/round-two/round-filter-segments";
import { RoundTwoStatusBadge } from "@/components/round-two/status-badge";
import { latestRoundStatus } from "@/lib/round-details";
import {
  candidateMatchesRound,
  clampRoundFilter,
  type RoundFilterValue,
} from "@/lib/round-two/round-filter";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CandidateRow = {
  type: "candidate";
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  gender: string | null;
  birthday: string | null;
  education: string | null;
  school: string | null;
  major: string | null;
  graduationYear: number | null;
  workExperience: string | null;
  notes: string | null;
  inviteToken: string | null;
  expiresAt: string | null;
  followupSentAt: string | null;
  followupSentToken: string | null;
  followupError: string | null;
  decisionStatus: string | null;
  session: any;
  createdAt: string;
  interviewTitle: string;
  interviewId: string;
  jobRole: string;
};

type WalkInRow = {
  type: "walkin";
  id: string;
  email: string | null;
  name: string | null;
  session: any;
  interviewTitle: string;
  interviewId: string;
  jobRole: string;
};

type UnifiedRow = CandidateRow | WalkInRow;

type SortKey =
  | "interview"
  | "role"
  | "name"
  | "email"
  | "phone"
  | "gender"
  | "birthday"
  | "education"
  | "school"
  | "major"
  | "gradYear"
  | "experience"
  | "notes"
  | "score"
  | "duration"
  | "started"
  | "finished"
  | "source"
  | "status"
  | "round"
  | "decision"
  | "link"
  | "followup"
  | "created"
  /** Default: newest activity first (session start, else when the row was created). */
  | "recent";

type SortDir = "asc" | "desc";

/* ------------------------------------------------------------------ */
/*  Column definitions                                                 */
/* ------------------------------------------------------------------ */

type ColumnDef = {
  key: string;
  label: string;
  sortKey: SortKey;
  defaultVisible: boolean;
  alwaysVisible?: boolean;
};

const COLUMNS: ColumnDef[] = [
  {
    key: "interview",
    label: "Interview",
    sortKey: "interview",
    defaultVisible: true,
    alwaysVisible: true,
  },
  { key: "role", label: "Role", sortKey: "role", defaultVisible: true },
  { key: "name", label: "Name", sortKey: "name", defaultVisible: true },
  { key: "email", label: "Email", sortKey: "email", defaultVisible: true },
  { key: "phone", label: "Phone", sortKey: "phone", defaultVisible: false },
  { key: "gender", label: "Gender", sortKey: "gender", defaultVisible: false },
  {
    key: "birthday",
    label: "Birthday",
    sortKey: "birthday",
    defaultVisible: false,
  },
  {
    key: "education",
    label: "Education",
    sortKey: "education",
    defaultVisible: false,
  },
  { key: "school", label: "School", sortKey: "school", defaultVisible: false },
  { key: "major", label: "Major", sortKey: "major", defaultVisible: false },
  {
    key: "gradYear",
    label: "Grad Year",
    sortKey: "gradYear",
    defaultVisible: false,
  },
  {
    key: "experience",
    label: "Experience",
    sortKey: "experience",
    defaultVisible: false,
  },
  { key: "notes", label: "Notes", sortKey: "notes", defaultVisible: false },
  { key: "status", label: "Status", sortKey: "status", defaultVisible: true },
  { key: "round", label: "Round", sortKey: "round", defaultVisible: true },
  { key: "decision", label: "Decision", sortKey: "decision", defaultVisible: true },
  { key: "link", label: "Link", sortKey: "link", defaultVisible: false },
  { key: "followup", label: "Follow-up", sortKey: "followup", defaultVisible: false },
  { key: "score", label: "Score", sortKey: "score", defaultVisible: true },
  {
    key: "duration",
    label: "Duration",
    sortKey: "duration",
    defaultVisible: true,
  },
  {
    key: "started",
    label: "Started",
    sortKey: "started",
    defaultVisible: true,
  },
  {
    key: "finished",
    label: "Finished",
    sortKey: "finished",
    defaultVisible: false,
  },
  { key: "source", label: "Source", sortKey: "source", defaultVisible: true },
  {
    key: "created",
    label: "Created",
    sortKey: "created",
    defaultVisible: true,
  },
];

const DEFAULT_VISIBLE = new Set(
  COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
);

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE_OPTIONS = [10, 20, 50];


function getTimeRangeCutoff(value: string): Date | null {
  return timeRangeCutoff(value);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getSessionStatus(row: UnifiedRow): string {
  const session = row.session;
  if (!session) return "Not Started";
  return session.status;
}

/** Media-review / recruiter outcome for list badges + filters. */
function getReviewOutcome(
  row: UnifiedRow,
): "approved" | "rejected" | "put_aside" | "followup_sent" | null {
  const decision = row.type === "candidate" ? row.decisionStatus : null;
  const media = (row.session as { mediaReviewStatus?: string | null } | null)?.mediaReviewStatus ?? null;

  if (decision === "approved" || media === "approved") return "approved";
  if (decision === "rejected" || media === "declined") return "rejected";
  if (media === "set_aside") return "put_aside";
  if (decision === "followup_sent") return "followup_sent";
  return null;
}

function reviewOutcomeLabel(
  kind: ReturnType<typeof getReviewOutcome>,
  isZh: boolean,
): string {
  switch (kind) {
    case "approved":
      return isZh ? "已通过" : "Approved";
    case "rejected":
      return isZh ? "已拒绝" : "Rejected";
    case "put_aside":
      return isZh ? "暂存" : "Put aside";
    case "followup_sent":
      return decisionStatusLabel("followup_sent");
    default:
      return "";
  }
}

function getSessionBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "COMPLETED":
    case "Completed":
    case "已完成":
      return "default";
    case "IN_PROGRESS":
    case "In Progress":
    case "Opened link":
    case "Setting up":
    case "进行中":
    case "已打开链接":
    case "准备中":
      return "outline";
    case "ABANDONED":
    case "Abandoned":
    case "DISQUALIFIED":
    case "Disqualified":
    case "已放弃":
    case "已取消资格":
      return "destructive";
    default:
      return "secondary";
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "-";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "-";
  return new Date(date).toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStartDate(row: UnifiedRow): string | null {
  const s = row.session;
  if (!s) return null;
  return s.startedAt ?? s.createdAt ?? null;
}

function getCandidateField(row: UnifiedRow): CandidateRow | null {
  return row.type === "candidate" ? (row as CandidateRow) : null;
}

function isRowLinkExpired(row: UnifiedRow): boolean {
  const c = getCandidateField(row);
  return !!c && isLinkExpired({ session: row.session, expiresAt: c.expiresAt });
}

function rowFollowup(row: UnifiedRow) {
  return leftFollowupState(getCandidateField(row), row.session);
}

function getSessionScore(row: UnifiedRow): number | null {
  const session = row.session;
  if (!session?.insights) return null;
  return getSessionOverallScore(
    session.insights as {
      questionEvaluations?: { score: number }[];
      criteriaEvaluations?: { score: number }[];
    },
  );
}

function rowHasRound2(row: UnifiedRow, r2Ids: Set<string>): boolean {
  return row.type === "candidate" && r2Ids.has(row.id);
}

function formatRoundExport(
  row: UnifiedRow,
  r2Ids: Set<string>,
  isZh: boolean,
): string {
  const parts = [isZh ? "第1轮" : "Round 1"];
  if (rowHasRound2(row, r2Ids)) parts.push(isZh ? "第2轮" : "Round 2");
  return parts.join(isZh ? "、" : " · ");
}

function getSortValue(
  row: UnifiedRow,
  key: SortKey,
  r2Ids?: Set<string>,
): string | number {
  const c = getCandidateField(row);
  switch (key) {
    case "interview":
      return row.interviewTitle.toLowerCase();
    case "role":
      return row.jobRole.toLowerCase();
    case "name":
      return (row.name ?? "").toLowerCase();
    case "email":
      return (row.email ?? "").toLowerCase();
    case "phone":
      return (c?.phone ?? "").toLowerCase();
    case "gender":
      return (c?.gender ?? "").toLowerCase();
    case "birthday":
      return c?.birthday ?? "";
    case "education":
      return (c?.education ?? "").toLowerCase();
    case "school":
      return (c?.school ?? "").toLowerCase();
    case "major":
      return (c?.major ?? "").toLowerCase();
    case "gradYear":
      return c?.graduationYear ?? -1;
    case "experience":
      return (c?.workExperience ?? "").toLowerCase();
    case "notes":
      return (c?.notes ?? "").toLowerCase();
    case "created":
      return c?.createdAt ? new Date(c.createdAt).getTime() : -1;
    case "recent":
      return latestTimestamp(row.session?.interviewBeganAt, getStartDate(row), c?.createdAt, row.session?.createdAt);
    case "score":
      return getSessionScore(row) ?? -1;
    case "duration":
      return listDurationSeconds(row.session) ?? -1;
    case "started":
      return getStartDate(row) ? new Date(getStartDate(row)!).getTime() : -1;
    case "finished":
      return row.session?.completedAt
        ? new Date(row.session.completedAt).getTime()
        : -1;
    case "source":
      return row.type === "walkin" ? "Walk-in" : "Invited";
    case "status":
      return getSessionStatus(row);
    case "round":
      return rowHasRound2(row, r2Ids ?? new Set()) ? 2 : 1;
    case "decision":
      return getReviewOutcome(row) ?? "";
    case "followup": {
      const f = rowFollowup(row);
      return !f.relevant ? 0 : f.sent ? 2 : 1;
    }
    case "link":
      // Expired links first (ascending), then by how soon the live ones lapse.
      return c?.expiresAt ? new Date(c.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
  }
}

/* ------------------------------------------------------------------ */
/*  Sortable Header                                                    */
/* ------------------------------------------------------------------ */

function SortableHead({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  direction: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  return (
    <TableHead
      className="group cursor-pointer select-none whitespace-nowrap hover:text-foreground"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          direction === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-40" />
        )}
      </span>
    </TableHead>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CandidatesPage() {
  const { locale } = useAppLocale();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { currentProject } = useProject();
  const projectId = currentProject?.id;
  const isZh = locale === "zh";
  const columnLabel: Record<string, string> = {
    interview: isZh ? "面试" : "Interview",
    name: isZh ? "姓名" : "Name",
    email: isZh ? "邮箱" : "Email",
    phone: isZh ? "电话" : "Phone",
    gender: isZh ? "性别" : "Gender",
    birthday: isZh ? "生日" : "Birthday",
    education: isZh ? "学历" : "Education",
    school: isZh ? "学校" : "School",
    major: isZh ? "专业" : "Major",
    gradYear: isZh ? "毕业年份" : "Grad Year",
    experience: isZh ? "经验" : "Experience",
    notes: isZh ? "备注" : "Notes",
    status: isZh ? "状态" : "Status",
    round: isZh ? "轮次" : "Round",
    decision: isZh ? "决定" : "Decision",
    score: isZh ? "分数" : "Score",
    duration: isZh ? "时长" : "Duration",
    started: isZh ? "开始时间" : "Started",
    finished: isZh ? "结束时间" : "Finished",
    source: isZh ? "来源" : "Source",
    created: isZh ? "创建时间" : "Created",
  };
  const timeRangeOptions = [
    { value: "ALL", label: isZh ? "全部时间" : "All Time" },
    { value: "today", label: isZh ? "今天" : "Today" },
    { value: "1d", label: isZh ? "过去 1 天" : "Past 1 day" },
    { value: "3d", label: isZh ? "过去 3 天" : "Past 3 days" },
    { value: "7d", label: isZh ? "过去 7 天" : "Past 7 days" },
    { value: "14d", label: isZh ? "过去 14 天" : "Past 14 days" },
    { value: "30d", label: isZh ? "过去 30 天" : "Past 30 days" },
    { value: "90d", label: isZh ? "过去 90 天" : "Past 90 days" },
  ];
  const statusLabel = useCallback((row: UnifiedRow) => {
    const label = formatSessionStatusLabel(row.session);
    if (!isZh) return label;
    switch (label) {
      case "Completed":
        return "已完成";
      case "In Progress":
        return "进行中";
      case "Abandoned":
        return "已放弃";
      case "Not Started":
        return "未开始";
      case "Opened link":
        return "已打开链接";
      case "Setting up":
        return "准备中";
      case "Disqualified":
        return "已取消资格";
      default:
        return label;
    }
  }, [isZh]);
  const sourceLabel = useCallback((source: "walkin" | "candidate") =>
    source === "walkin"
      ? isZh
        ? "现场"
        : "Walk-in"
      : isZh
        ? "邀请"
        : "Invited", [isZh]);

  // ── State ──
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [timeRange, setTimeRange] = useState("ALL");
  const [roundFilter, setRoundFilter] = useState<RoundFilterValue>("ALL");
  const [sortKey, setSortKey] = useState<SortKey | null>("recent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [extendFor, setExtendFor] = useState<{ id: string; name: string | null; expiresAt: string | null } | null>(null);
  const [detailEdit, setDetailEdit] = useState(false);
  const [visibleColumns, setVisibleColumns] =
    useState<Set<string>>(DEFAULT_VISIBLE);

  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    COLUMNS.map((c) => c.key),
  );

  const toggleColumn = useCallback((key: string) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Column reorder via document-level pointer tracking ──
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const draggingColRef = useRef<string | null>(null);
  const dragOverColRef = useRef<string | null>(null);

  const handleGripPointerDown = useCallback(
    (key: string, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingColRef.current = key;
      dragOverColRef.current = null;
      setDraggingCol(key);
      setDragOverCol(null);
    },
    [],
  );

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingColRef.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest<HTMLElement>("[data-col-key]");
      const key = row?.dataset.colKey ?? null;
      if (
        key &&
        key !== draggingColRef.current &&
        key !== dragOverColRef.current
      ) {
        dragOverColRef.current = key;
        setDragOverCol(key);
      } else if (!key && dragOverColRef.current) {
        dragOverColRef.current = null;
        setDragOverCol(null);
      }
    };

    const onPointerUp = () => {
      const src = draggingColRef.current;
      const tgt = dragOverColRef.current;
      if (src && tgt && src !== tgt) {
        setColumnOrder((prev) => {
          const next = [...prev];
          const srcIdx = next.indexOf(src);
          const tgtIdx = next.indexOf(tgt);
          if (srcIdx === -1 || tgtIdx === -1) return prev;
          next.splice(srcIdx, 1);
          next.splice(tgtIdx, 0, src);
          return next;
        });
      }
      draggingColRef.current = null;
      dragOverColRef.current = null;
      setDraggingCol(null);
      setDragOverCol(null);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // ── Data ──
  const candidateList = trpc.candidate.listAll.useQuery(
    { limit: 200, projectId: projectId ?? undefined },
    { enabled: !!projectId, refetchInterval: (data) => livePollInterval(data) },
  );
  const roundMeta = trpc.roundTwo.projectRoundMeta.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const maxRound = roundMeta.data?.maxRound ?? 1;
  const effectiveRoundFilter = clampRoundFilter(roundFilter, maxRound);
  const r2CandidateIds = useMemo(
    () => new Set(roundMeta.data?.r2CandidateIds ?? []),
    [roundMeta.data?.r2CandidateIds],
  );
  const r2ByCandidateId = roundMeta.data?.r2ByCandidateId ?? {};

  const removeCandidatesMutation = trpc.candidate.removeMany.useMutation({
    onSuccess: () => invalidateAll(),
    onError: (err) => {
      toast({
        title: isZh ? "删除失败" : "Failed to remove",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const removeSessionsMutation = trpc.session.deleteMany.useMutation({
    onSuccess: () => invalidateAll(),
    onError: (err) => {
      toast({
        title: isZh ? "删除失败" : "Failed to remove",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const invalidateAll = useCallback(() => {
    utils.candidate.listAll.invalidate();
  }, [utils]);

  // ── Build unified rows ──
  const candidates: CandidateRow[] = (candidateList.data?.candidates ?? []).map(
    (c: any) => ({
      type: "candidate" as const,
      id: c.id,
      email: c.email,
      name: c.name,
      phone: c.phone,
      gender: c.gender ?? null,
      birthday: c.birthday ?? null,
      education: c.education ?? null,
      school: c.school ?? null,
      major: c.major ?? null,
      graduationYear: c.graduationYear ?? null,
      workExperience: c.workExperience ?? null,
      notes: c.notes ?? null,
      inviteToken: c.inviteToken,
      expiresAt: c.expiresAt ?? null,
      followupSentAt: c.followupSentAt ?? null,
      followupSentToken: c.followupSentToken ?? null,
      followupError: c.followupError ?? null,
      decisionStatus: (c.decisionStatus as string | null) ?? "none",
      session: c.session,
      createdAt: c.createdAt,
      interviewTitle: cleanInterviewTitle(c.interview?.title) || "-",
      interviewId: c.interview?.id ?? c.interviewId,
      jobRole:
        resolveJobRole({
          jobRole: c.interview?.jobRole,
          title: cleanInterviewTitle(c.interview?.title) || c.interview?.title,
          objective: c.interview?.objective,
        }) ?? "—",
    }),
  );

  const walkIns: WalkInRow[] = (candidateList.data?.walkInSessions ?? []).map(
    (s: any) => ({
      type: "walkin" as const,
      id: s.id,
      email: s.participantEmail,
      name: s.participantName,
      session: s,
      interviewTitle: cleanInterviewTitle(s.interview?.title) || "-",
      interviewId: s.interview?.id ?? s.interviewId,
      jobRole:
        resolveJobRole({
          jobRole: s.interview?.jobRole,
          title: cleanInterviewTitle(s.interview?.title) || s.interview?.title,
          objective: s.interview?.objective,
        }) ?? "—",
    }),
  );

  const isFiltering =
    searchQuery.trim() ||
    statusFilter !== "ALL" ||
    timeRange !== "ALL" ||
    effectiveRoundFilter !== "ALL";

  // ── Filter + Sort ──
  const processedRows = useMemo(() => {
    const allRows: UnifiedRow[] = [...candidates, ...walkIns];
    let result = allRows;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (row) =>
          (row.email?.toLowerCase().includes(q) ?? false) ||
          (row.name?.toLowerCase().includes(q) ?? false) ||
          row.interviewTitle.toLowerCase().includes(q) ||
          row.jobRole.toLowerCase().includes(q),
      );
    }

    if (statusFilter !== "ALL") {
      result = result.filter((row) => {
        const s = getSessionStatus(row);
        // Filter on the displayed label: quiet pre-flight sessions read "Not Started" (never abandoned).
        const label = formatSessionStatusLabel(row.session);
        const review = getReviewOutcome(row);
        if (statusFilter === "EXPIRED") return isRowLinkExpired(row);
        if (statusFilter === "FOLLOWUP_SENT") return rowFollowup(row).sent;
        if (statusFilter === "FOLLOWUP_NOT_SENT") {
          const f = rowFollowup(row);
          return f.relevant && !f.sent;
        }
        if (statusFilter === "APPROVED") return review === "approved";
        if (statusFilter === "REJECTED") return review === "rejected";
        if (statusFilter === "PUT_ASIDE") return review === "put_aside";
        if (statusFilter === "DECISION_FOLLOWUP") return review === "followup_sent";
        if (statusFilter === "PENDING_REVIEW") {
          return (
            s === "COMPLETED" &&
            review === null &&
            !(row.session as { mediaClearedAt?: string | null } | null)?.mediaClearedAt
          );
        }
        if (statusFilter === "NOT_STARTED") return label === "Not Started";
        if (statusFilter === "ABANDONED") return label === "Abandoned";
        if (statusFilter === "IN_PROGRESS") return s === "IN_PROGRESS" && label !== "Not Started";
        return s === statusFilter;
      });
    }

    const cutoff = getTimeRangeCutoff(timeRange);
    if (cutoff) {
      result = result.filter((row) => {
        // "Today" also counts invites created today that haven't started yet.
        const started = getStartDate(row) ?? (timeRange === "today" ? getCandidateField(row)?.createdAt ?? null : null);
        if (!started) return false;
        return new Date(started) >= cutoff;
      });
    }

    if (effectiveRoundFilter !== "ALL") {
      result = result.filter((row) =>
        candidateMatchesRound(
          {
            id: row.id,
            hasSession: !!row.session,
          },
          effectiveRoundFilter,
          r2CandidateIds,
        ),
      );
    }

    if (sortKey) {
      result = [...result].sort((a, b) => {
        const va = getSortValue(a, sortKey, r2CandidateIds);
        const vb = getSortValue(b, sortKey, r2CandidateIds);
        const cmp =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [
    candidates,
    walkIns,
    searchQuery,
    statusFilter,
    timeRange,
    sortKey,
    sortDir,
    effectiveRoundFilter,
    r2CandidateIds,
  ]);

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(processedRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedRows = useMemo(
    () => processedRows.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [processedRows, safePage, pageSize],
  );

  // ── Sort handler ──
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "started" || key === "finished" || key === "created"
          ? "desc"
          : "asc",
      );
    }
    setPage(0);
  };

  // ── Multi-select ──
  const pageIds = paginatedRows.map((r) => `${r.type}-${r.id}`);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  const toggleSelect = useCallback((compositeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(compositeId)) next.delete(compositeId);
      else next.add(compositeId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }, [allPageSelected, pageIds]);

  const isBulkDeleting =
    removeCandidatesMutation.isLoading || removeSessionsMutation.isLoading;

  const handleBulkDelete = useCallback(() => {
    const candidateIds = Array.from(selectedIds)
      .filter((id) => id.startsWith("candidate-"))
      .map((id) => id.replace("candidate-", ""));
    const sessionIds = Array.from(selectedIds)
      .filter((id) => id.startsWith("walkin-"))
      .map((id) => id.replace("walkin-", ""));

    let pending = 0;
    const onDone = () => {
      pending--;
      if (pending === 0) {
        toast({
          title: isZh
            ? `已移除 ${selectedIds.size} 条记录`
            : `${selectedIds.size} entry${selectedIds.size > 1 ? "s" : ""} removed`,
        });
        setSelectedIds(new Set());
      }
    };

    if (candidateIds.length > 0) {
      pending++;
      removeCandidatesMutation.mutate(
        { ids: candidateIds },
        { onSuccess: onDone },
      );
    }
    if (sessionIds.length > 0) {
      pending++;
      removeSessionsMutation.mutate({ ids: sessionIds }, { onSuccess: onDone });
    }
  }, [
    isZh,
    selectedIds,
    removeCandidatesMutation,
    removeSessionsMutation,
    toast,
  ]);

  // Frozen column + ordered dynamic columns
  const frozenCol = COLUMNS.find((c) => c.alwaysVisible)!;
  const orderedColumns = useMemo(() => {
    const orderMap = new Map(columnOrder.map((key, idx) => [key, idx]));
    return [...COLUMNS].sort(
      (a, b) => (orderMap.get(a.key) ?? 0) - (orderMap.get(b.key) ?? 0),
    );
  }, [columnOrder]);
  const dynamicColumns = orderedColumns.filter(
    (c) => c !== frozenCol && visibleColumns.has(c.key),
  );

  // Navigate to session detail
  const handleRowClick = (row: UnifiedRow) => {
    const session = row.session;
    if (!session || getSessionStatus(row) === "Not Started") return;
    window.open(
      `/interviews/${row.interviewId}/edit/sessions?session=${session.id}`,
      "_blank",
    );
  };

  const handleExport = useCallback(() => {
    const visibleCols = [frozenCol, ...dynamicColumns];
    const rows = processedRows.map((row) => {
      const c = getCandidateField(row);
      const status = getSessionStatus(row);
      const session = row.session;
      const hasSession = !!session && status !== "Not Started";
      const record: Record<string, string | number | null> = {};
      for (const col of visibleCols) {
        switch (col.key) {
          case "interview":
            record[col.label] = row.interviewTitle;
            break;
          case "role":
            record[col.label] = row.jobRole;
            break;
          case "name":
            record[col.label] = row.name || "";
            break;
          case "email":
            record[col.label] = row.email || "";
            break;
          case "phone":
            record[col.label] = c?.phone || "";
            break;
          case "gender":
            record[col.label] = c?.gender || "";
            break;
          case "birthday":
            record[col.label] = c?.birthday || "";
            break;
          case "education":
            record[col.label] = c?.education || "";
            break;
          case "school":
            record[col.label] = c?.school || "";
            break;
          case "major":
            record[col.label] = c?.major || "";
            break;
          case "gradYear":
            record[col.label] = c?.graduationYear ?? "";
            break;
          case "experience":
            record[col.label] = c?.workExperience || "";
            break;
          case "notes":
            record[col.label] = c?.notes || "";
            break;
          case "created":
            record[col.label] = c?.createdAt ? formatDate(c.createdAt) : "";
            break;
          case "score": {
            const sv = getSessionScore(row);
            record[col.label] = sv !== null ? Number(sv.toFixed(1)) : "";
            break;
          }
          case "duration":
            record[col.label] = hasSession
              ? formatDuration(listDurationSeconds(session))
              : "";
            break;
          case "started":
            record[col.label] = hasSession ? formatDate(getStartDate(row)) : "";
            break;
          case "finished":
            record[col.label] =
              hasSession && session.completedAt
                ? formatDate(session.completedAt)
                : "";
            break;
          case "source":
            record[col.label] = sourceLabel(row.type);
            break;
          case "status":
            record[col.label] = statusLabel(row);
            break;
          case "round":
            record[col.label] = formatRoundExport(row, r2CandidateIds, isZh);
            break;
          case "decision":
            record[col.label] = reviewOutcomeLabel(getReviewOutcome(row), isZh);
            break;
          case "followup": {
            const f = rowFollowup(row);
            record[col.label] = !f.relevant
              ? ""
              : f.sent
                ? `Sent ${f.sentAt ? formatDate(f.sentAt) : ""}`.trim()
                : `Not sent${f.error ? `: ${f.error}` : ""}`;
            break;
          }
          case "link": {
            const exp = getCandidateField(row)?.expiresAt;
            record[col.label] = isRowLinkExpired(row)
              ? `Expired ${formatDate(exp)}`
              : exp
                ? `Valid until ${formatDate(exp)}`
                : "";
            break;
          }
        }
      }
      return record;
    });
    exportToXlsx(rows, `sessions-${new Date().toISOString().slice(0, 10)}`);
  }, [
    dynamicColumns,
    frozenCol,
    isZh,
    processedRows,
    r2CandidateIds,
    sourceLabel,
    statusLabel,
  ]);

  // ── Cell values ──
  function getCellValue(row: UnifiedRow, key: string): JSX.Element | string {
    const c = getCandidateField(row);
    const status = getSessionStatus(row);
    const session = row.session;
    const hasSession = !!session && status !== "Not Started";

    switch (key) {
      case "role":
        return (
          <span className="max-w-[160px] truncate font-medium" title={row.jobRole}>
            {row.jobRole}
          </span>
        );
      case "name":
        return (
          <span className="font-medium">
            {row.name || <span className="text-muted-foreground">-</span>}
          </span>
        );
      case "email":
        return (
          <span className="text-muted-foreground">{row.email || "-"}</span>
        );
      case "phone":
        return (
          <span className="whitespace-nowrap text-muted-foreground">
            {c?.phone || "-"}
          </span>
        );
      case "gender":
        return (
          <span className="text-muted-foreground">{c?.gender || "-"}</span>
        );
      case "birthday":
        return (
          <span className="text-muted-foreground">{c?.birthday || "-"}</span>
        );
      case "education":
        return (
          <span className="text-muted-foreground">{c?.education || "-"}</span>
        );
      case "school":
        return (
          <span className="max-w-[200px] truncate text-muted-foreground">
            {c?.school || "-"}
          </span>
        );
      case "major":
        return (
          <span className="max-w-[160px] truncate text-muted-foreground">
            {c?.major || "-"}
          </span>
        );
      case "gradYear":
        return (
          <span className="text-muted-foreground">
            {c?.graduationYear || "-"}
          </span>
        );
      case "experience":
        return (
          <span className="text-muted-foreground">
            {c?.workExperience || "-"}
          </span>
        );
      case "notes":
        return (
          <span
            className="block max-w-[200px] truncate text-muted-foreground"
            title={c?.notes || undefined}
          >
            {c?.notes || "-"}
          </span>
        );
      case "created":
        return (
          <span className="whitespace-nowrap">
            {c?.createdAt ? formatDate(c.createdAt) : "-"}
          </span>
        );
      case "score":
        return <ScoreWithBreakdown insights={session?.insights} />;
      case "duration":
        return (
          <span>
            {hasSession ? formatDuration(listDurationSeconds(session)) : "-"}
          </span>
        );
      case "started":
        return (
          <span className="whitespace-nowrap">
            {hasSession ? formatDate(getStartDate(row)) : "-"}
          </span>
        );
      case "finished":
        return (
          <span className="whitespace-nowrap">
            {hasSession && session.completedAt
              ? formatDate(session.completedAt)
              : "-"}
          </span>
        );
      case "source":
        return row.type === "walkin" ? (
          <Badge variant="secondary" className="whitespace-nowrap text-xs">
            {sourceLabel("walkin")}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="whitespace-nowrap border-transparent bg-primary/5 text-xs text-primary"
          >
            {sourceLabel("candidate")}
          </Badge>
        );
      case "status": {
        // Round 2 filter → show live-panel status, not Round 1 session labels.
        if (effectiveRoundFilter === 2 && row.type === "candidate") {
          const r2 = r2ByCandidateId[row.id];
          return r2 ? (
            <div className="flex flex-col items-start gap-0.5">
              <RoundTwoStatusBadge status={r2.status} />
            </div>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        }
        // "All rounds": once a candidate has a Round 2 that is scheduled / live / ended, lead with it
        // (the Round 1 status stays underneath) instead of showing only the older Round 1 result.
        const latestR2 = effectiveRoundFilter !== 1 && row.type === "candidate" ? r2ByCandidateId[row.id] : undefined;
        if (latestR2 && latestRoundStatus(statusLabel(row), latestR2).round === 2) {
          return (
            <div className="flex flex-col items-start gap-0.5">
              <span className="inline-flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{isZh ? "第2轮" : "R2"}</span>
                <RoundTwoStatusBadge status={latestR2.status} />
              </span>
              <span className="text-[10px] text-muted-foreground">
                {isZh ? "第1轮" : "R1"} · {statusLabel(row)}
              </span>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-start gap-0.5">
            <Badge
              variant={getSessionBadgeVariant(statusLabel(row))}
              className="whitespace-nowrap"
            >
              {statusLabel(row)}
            </Badge>
            <QuitEarlyBadge session={row.session} label={isZh ? "提前退出" : undefined} />
            {isRowLinkExpired(row) && <ExpiredBadge />}
          </div>
        );
      }
      case "round": {
        const hasR2 = rowHasRound2(row, r2CandidateIds);
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              variant="outline"
              className="whitespace-nowrap text-xs font-normal"
            >
              {isZh ? "第1轮" : "Round 1"}
            </Badge>
            {hasR2 && (
              <Badge
                variant="outline"
                className="whitespace-nowrap border-primary/40 text-xs font-normal text-primary"
              >
                {isZh ? "第2轮" : "Round 2"}
              </Badge>
            )}
          </div>
        );
      }
      case "decision": {
        const review = getReviewOutcome(row);
        // Incomplete follow-up is tracked in Follow-up column / filters — not Decision.
        if (!review || review === "followup_sent") {
          return <span className="text-muted-foreground">-</span>;
        }
        const label = reviewOutcomeLabel(review, isZh);
        return (
          <Badge
            variant="outline"
            className={cn(
              "whitespace-nowrap",
              review === "approved" && "border-green-600 text-green-700",
              review === "rejected" && "border-red-600 text-red-700",
              review === "put_aside" && "border-amber-600 text-amber-700",
            )}
          >
            {label}
          </Badge>
        );
      }
      case "followup":
        return c && rowFollowup(row).relevant ? (
          <LeftFollowupAction candidateId={c.id} candidate={c} session={row.session} variant="compact" />
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      case "link": {
        if (!c?.expiresAt) return <span className="text-muted-foreground">-</span>;
        const exp = new Date(c.expiresAt);
        const when = exp.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        if (isRowLinkExpired(row)) {
          return (
            <div className="flex flex-col items-start gap-0.5">
              <ExpiredBadge />
              <span className="text-[10px] text-muted-foreground">Expired {when}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExtendFor({ id: c.id, name: c.name, expiresAt: c.expiresAt });
                }}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
              >
                <CalendarClock className="h-3 w-3" />
                Extend expiry
              </button>
            </div>
          );
        }
        return (
          <span className="whitespace-nowrap text-muted-foreground">
            {status === "COMPLETED" || status === "DISQUALIFIED" ? "-" : `Until ${when}`}
          </span>
        );
      }
      default:
        return "-";
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">{isZh ? "会话" : "Sessions"}</h1>
        <p className="text-muted-foreground">
          {isZh
            ? "查看所有面试中的会话"
            : "All sessions across your interviews"}
        </p>
      </div>

      {/* Filters toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={
              isZh
                ? "按面试、姓名或邮箱搜索..."
                : "Search by interview, name, or email..."
            }
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>

        <Select
          value={timeRange}
          onValueChange={(v) => {
            setTimeRange(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeRangeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[190px]">
            <CircleDot className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">
              {isZh ? "全部状态" : "All Status"}
            </SelectItem>
            <SelectItem value="APPROVED">
              {isZh ? "已通过 / 入选" : "Approved / Selected"}
            </SelectItem>
            <SelectItem value="REJECTED">
              {isZh ? "已拒绝" : "Rejected"}
            </SelectItem>
            <SelectItem value="PUT_ASIDE">
              {isZh ? "暂存" : "Put aside"}
            </SelectItem>
            <SelectItem value="PENDING_REVIEW">
              {isZh ? "待审核" : "Pending review"}
            </SelectItem>
            <SelectItem value="DECISION_FOLLOWUP">
              {isZh ? "已发不完整跟进" : "Incomplete follow-up"}
            </SelectItem>
            <SelectItem value="COMPLETED">
              {isZh ? "已完成" : "Completed"}
            </SelectItem>
            <SelectItem value="IN_PROGRESS">
              {isZh ? "进行中" : "In Progress"}
            </SelectItem>
            <SelectItem value="ABANDONED">
              {isZh ? "已放弃" : "Abandoned"}
            </SelectItem>
            <SelectItem value="DISQUALIFIED">
              {isZh ? "已取消资格" : "Disqualified"}
            </SelectItem>
            <SelectItem value="NOT_STARTED">
              {isZh ? "未开始" : "Not Started"}
            </SelectItem>
            <SelectItem value="EXPIRED">
              {isZh ? "链接已过期" : "Link Expired"}
            </SelectItem>
            <SelectItem value="FOLLOWUP_SENT">
              {isZh ? "已发送跟进" : "Follow-up Sent"}
            </SelectItem>
            <SelectItem value="FOLLOWUP_NOT_SENT">
              {isZh ? "未发送跟进" : "Follow-up Not Sent"}
            </SelectItem>
          </SelectContent>
        </Select>

        <RoundFilterSegments
          value={effectiveRoundFilter}
          maxRound={maxRound}
          onChange={(v) => {
            setRoundFilter(v);
            setPage(0);
          }}
        />

        <Button
          variant="outline"
          onClick={handleExport}
          disabled={processedRows.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          {isZh ? "导出" : "Export"}
        </Button>

        {selectedIds.size > 0 && (
          <>
            <Button
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {isZh
                ? `删除（${selectedIds.size}）`
                : `Delete (${selectedIds.size})`}
            </Button>
            <Button variant="outline" onClick={() => setSelectedIds(new Set())}>
              <X className="mr-1 h-4 w-4" />
              {isZh ? "取消" : "Cancel"}
            </Button>
          </>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        {!candidateList.isLoading && processedRows.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            {isFiltering
              ? isZh
                ? "没有符合筛选条件的会话。"
                : "No sessions match your filters."
              : isZh
                ? "还没有会话。"
                : "No sessions yet."}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto code-scrollbar">
              <Table className="border-collapse">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {/* Frozen left: checkbox + interview name */}
                    <TableHead className="sticky left-0 z-20 min-w-[180px] bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={
                            allPageSelected
                              ? true
                              : somePageSelected
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={toggleSelectAll}
                        />
                        <span
                          className="group inline-flex cursor-pointer items-center gap-1 select-none whitespace-nowrap hover:text-foreground"
                          onClick={() => handleSort(frozenCol.sortKey)}
                        >
                          {columnLabel[frozenCol.key] ?? frozenCol.label}
                          {sortKey === frozenCol.sortKey ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-40" />
                          )}
                        </span>
                      </div>
                    </TableHead>

                    {/* Dynamic columns */}
                    {dynamicColumns.map((col) => (
                      <SortableHead
                        key={col.key}
                        label={columnLabel[col.key] ?? col.label}
                        sortKey={col.sortKey}
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={handleSort}
                      />
                    ))}

                    {/* Frozen right: gear icon */}
                    <TableHead className="sticky right-0 z-20 w-10 bg-background shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                          >
                            <Settings className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-48 p-1">
                          <div className="max-h-[320px] overflow-y-auto code-scrollbar">
                            {orderedColumns
                              .filter((col) => !col.alwaysVisible)
                              .map((col) => (
                                <div
                                  key={col.key}
                                  data-col-key={col.key}
                                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors ${
                                    draggingCol === col.key
                                      ? "bg-accent/80 opacity-50"
                                      : dragOverCol === col.key
                                        ? "border-t-2 border-primary bg-primary/5"
                                        : "hover:bg-accent hover:text-accent-foreground"
                                  }`}
                                >
                                  <GripVertical
                                    className="h-3.5 w-3.5 shrink-0 cursor-grab touch-none text-muted-foreground/50 active:cursor-grabbing"
                                    onPointerDown={(e) =>
                                      handleGripPointerDown(col.key, e)
                                    }
                                  />
                                  <span
                                    className="flex-1 cursor-pointer select-none text-left"
                                    onClick={() => {
                                      if (!draggingCol) toggleColumn(col.key);
                                    }}
                                  >
                                    {columnLabel[col.key] ?? col.label}
                                  </span>
                                  {visibleColumns.has(col.key) && (
                                    <Check className="h-4 w-4 shrink-0 text-primary" />
                                  )}
                                </div>
                              ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidateList.isLoading ? (
                    Array.from({ length: 5 }).map((_, idx) => (
                      <TableRow key={`skeleton-candidate-${idx}`}>
                        <TableCell className="sticky left-0 z-10 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                          <div className="flex items-center gap-3">
                            <Skeleton className="h-4 w-4 rounded" />
                            <Skeleton className="h-4 w-32 rounded" />
                          </div>
                        </TableCell>
                        {dynamicColumns.map((col) => (
                          <TableCell key={col.key}>
                            {col.key === "status" ? (
                              <Skeleton className="h-5 w-20 rounded-full" />
                            ) : col.key === "score" || col.key === "duration" || col.key === "messages" ? (
                              <Skeleton className="h-4 w-12 rounded" />
                            ) : (
                              <Skeleton className="h-4 w-28 rounded" />
                            )}
                          </TableCell>
                        ))}
                        <TableCell className="sticky right-0 z-10 w-10 bg-background shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                          <Skeleton className="h-6 w-6 rounded-md" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    paginatedRows.map((row) => {
                    const status = getSessionStatus(row);
                    const hasSession =
                      !!row.session && status !== "Not Started";
                    const compositeId = `${row.type}-${row.id}`;

                    return (
                      <TableRow
                        key={compositeId}
                        className={
                          row.type === "candidate" || hasSession ? "cursor-pointer" : undefined
                        }
                        data-state={
                          selectedIds.has(compositeId) ? "selected" : undefined
                        }
                        onClick={
                          row.type === "candidate"
                            ? () => {
                                setDetailEdit(false);
                                setDetailId(row.id);
                              }
                            : hasSession
                              ? () => handleRowClick(row)
                              : undefined
                        }
                      >
                        {/* Frozen left: checkbox + interview */}
                        <TableCell className="sticky left-0 z-10 bg-background shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                          <div className="flex items-center gap-3">
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(compositeId)}
                                onCheckedChange={() =>
                                  toggleSelect(compositeId)
                                }
                              />
                            </div>
                            <span className="font-medium">
                              {row.interviewTitle}
                            </span>
                          </div>
                        </TableCell>

                        {/* Dynamic columns */}
                        {dynamicColumns.map((col) => (
                          <TableCell key={col.key}>
                            {getCellValue(row, col.key)}
                          </TableCell>
                        ))}

                        {/* Frozen right: action */}
                        <TableCell
                          onClick={(e) => e.stopPropagation()}
                          className="sticky right-0 z-10 w-10 whitespace-nowrap bg-background shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                        >
                          {row.type === "candidate" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={isZh ? "编辑" : "Edit session details"}
                              onClick={() => {
                                setDetailEdit(true);
                                setDetailId(row.id);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                          {hasSession && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={
                                isZh ? "查看会话详情" : "View session details"
                              }
                              onClick={() => handleRowClick(row)}
                            >
                              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  }))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {processedRows.length > PAGE_SIZE_OPTIONS[0] && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{isZh ? "每页行数" : "Rows per page"}</span>
                  <select
                    className="rounded border bg-background px-2 py-1 text-sm"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(0);
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  <span className="ml-2">
                    {safePage * pageSize + 1}–
                    {Math.min((safePage + 1) * pageSize, processedRows.length)}{" "}
                    {isZh ? " / 共 " : " of "} {processedRows.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    {safePage + 1} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((p) => Math.min(totalPages - 1, p + 1))
                    }
                    disabled={safePage >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isZh ? "删除会话" : "Delete Sessions"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isZh
                ? `确认要删除 ${selectedIds.size} 个会话吗？这会永久移除所选记录及其关联数据，此操作无法撤销。`
                : `Are you sure you want to delete ${selectedIds.size} session${selectedIds.size > 1 ? "s" : ""}? This will permanently remove the selected entries and any associated data. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isZh ? "取消" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                handleBulkDelete();
                setConfirmDelete(false);
              }}
            >
              {isZh ? "删除" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CandidateDetailSheet
        candidateId={detailId}
        startInEdit={detailEdit}
        onOpenChange={(o) => !o && setDetailId(null)}
        onSaved={invalidateAll}
      />
      {extendFor && (
        <ExtendExpiryDialog
          open
          onOpenChange={(o) => !o && setExtendFor(null)}
          candidateId={extendFor.id}
          candidateName={extendFor.name}
          expiresAt={extendFor.expiresAt}
          onExtended={invalidateAll}
          sendLabel="Extend & open send options"
          onExtendAndSend={() => {
            // Hand over to the detail panel, whose resend / follow-up controls are live again.
            setDetailEdit(false);
            setDetailId(extendFor.id);
          }}
        />
      )}
    </div>
  );
}
