"use client";

import { useMemo, useState } from "react";
import { ConfirmAction } from "@/components/admin/confirm-action";
import {
  EmptyState,
  PageHeader,
  Panel,
  StatCard,
  StatusPill,
  TacticalButton,
} from "@/components/admin/admin-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  AlertOctagon,
  Building2,
  Check,
  Clock,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  FolderGit2,
  Grid,
  HardDrive,
  Image as ImageIcon,
  Layers,
  List,
  Mic,
  Play,
  RefreshCw,
  Search,
  Trash2,
  User,
  X,
  ZoomIn,
} from "lucide-react";

type Scope = "all" | "organizations" | "projects";
type CategoryFilter = "all" | "recordings" | "screenshots" | "resumes" | "raw";
type ViewMode = "grid" | "table";

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function AdminStoragePage() {
  const { toast } = useToast();

  // Navigation tab: Explorer (browse assets) vs Retention (prune files)
  const [activeTab, setActiveTab] = useState<"explorer" | "retention">("explorer");

  // Telemetry queries
  const statsQuery = trpc.platform.storageStats.useQuery(undefined, {
    staleTime: 30_000,
  });

  // Storage index for org and project dropdowns
  const index = trpc.platform.storageIndex.useQuery(undefined, {
    staleTime: 60_000,
  });

  // Explorer filters & state
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Media Inspection Modal / Lightbox
  const [activePreview, setActivePreview] = useState<any | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Retention tab state
  const [scope, setScope] = useState<Scope>("organizations");
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Fetch stored files with current filters
  const filesQuery = trpc.platform.storedFiles.useQuery(
    {
      category,
      organizationId: selectedOrgId || undefined,
      projectId: selectedProjectId || undefined,
      search: searchQuery || undefined,
      limit: 120,
    },
    {
      staleTime: 20_000,
    },
  );

  const orgNameMap = useMemo(() => {
    return new Map((index.data?.organizations ?? []).map((o) => [o.id, o.name]));
  }, [index.data?.organizations]);

  // Projects filtered by selected organization
  const availableProjects = useMemo(() => {
    const all = index.data?.projects ?? [];
    if (!selectedOrgId) return all;
    return all.filter((p) => p.organizationId === selectedOrgId);
  }, [index.data?.projects, selectedOrgId]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
    toast({
      title: "Storage key copied",
      description: text,
    });
  };

  // Retention delete mutation
  const remove = trpc.platform.deleteStoredFiles.useMutation({
    onSuccess: (res) => {
      toast({
        title: "Stored files deleted",
        description: `${res.objects} file${res.objects === 1 ? "" : "s"} removed from ${res.sessions} session${res.sessions === 1 ? "" : "s"}. Candidate scores were preserved.`,
      });
      setDeleteOpen(false);
      setOrgIds([]);
      setProjectIds([]);
      filesQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) =>
      toast({
        title: "Could not delete stored files",
        description: err.message,
        variant: "destructive",
      }),
  });

  const toggle = (list: string[], id: string, set: (next: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const selectAll = (allIds: string[], set: (next: string[]) => void) => {
    set(allIds);
  };

  const clearSelection = (set: (next: string[]) => void) => {
    set([]);
  };

  const canDelete =
    scope === "all" ||
    (scope === "organizations" && orgIds.length > 0) ||
    (scope === "projects" && projectIds.length > 0);

  const allOrgIds = useMemo(
    () => (index.data?.organizations ?? []).map((o) => o.id),
    [index.data?.organizations],
  );

  const allProjIds = useMemo(
    () => (index.data?.projects ?? []).map((p) => p.id),
    [index.data?.projects],
  );

  const storageConfig = statsQuery.data?.config || filesQuery.data?.config;
  const counts = filesQuery.data?.counts || {
    all: 0,
    recordings: 0,
    screenshots: 0,
    resumes: 0,
    raw: 0,
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        kicker="Backblaze B2 & Object Store"
        title="Stored Files & Media Explorer"
        description="Browse, play candidate interview recordings, inspect proctoring captures, and view candidate resumes directly from Backblaze B2 without opening external terminals."
        actions={
          <div className="flex items-center gap-2">
            <TacticalButton
              variant="outline"
              size="sm"
              onClick={() => {
                filesQuery.refetch();
                statsQuery.refetch();
              }}
              className="gap-1.5 text-xs h-8"
              disabled={filesQuery.isFetching}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", filesQuery.isFetching && "animate-spin")}
              />
              <span>Refresh</span>
            </TacticalButton>
          </div>
        }
      />

      {/* Telemetry Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          title="Object Store Provider"
          value={storageConfig?.provider || "Backblaze B2"}
          subtitle={
            storageConfig?.region
              ? `Bucket: ${storageConfig.bucket} • Region: ${storageConfig.region}`
              : `Bucket: ${storageConfig?.bucket || "configured-bucket"}`
          }
          trend={storageConfig?.enabled ? "Connected" : "Local Disk"}
          trendDirection={storageConfig?.enabled ? "up" : "neutral"}
          icon={Cloud}
        />
        <StatCard
          title="Audio & Video Recordings"
          value={counts.recordings}
          subtitle="Candidate audio & streamable clips"
          trend="Available"
          trendDirection="neutral"
          icon={Mic}
        />
        <StatCard
          title="Proctoring Images"
          value={counts.screenshots}
          subtitle="Screen captures & webcam frames"
          trend="Tracked"
          trendDirection="neutral"
          icon={ImageIcon}
        />
        <StatCard
          title="Candidate Resumes & CVs"
          value={counts.resumes}
          subtitle="Attached CVs & application files"
          trend="Indexed"
          trendDirection="neutral"
          icon={FileText}
        />
      </div>

      {/* Main Mode Navigation Strip */}
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 dark:border-white/[0.08]">
        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card p-1 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60">
          <button
            type="button"
            onClick={() => setActiveTab("explorer")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95",
              activeTab === "explorer"
                ? "bg-primary text-white shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Browse Stored Files</span>
            <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-mono">
              {filesQuery.data?.total ?? "..."}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("retention")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95",
              activeTab === "retention"
                ? "bg-primary text-white shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            <span>Retention & Pruning</span>
          </button>
        </div>

        {activeTab === "explorer" && (
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-1 dark:border-white/[0.08] dark:bg-zinc-900/50">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-label="Grid View"
              className={cn(
                "rounded-md p-1.5 transition-colors",
                viewMode === "grid"
                  ? "bg-background text-foreground shadow-sm dark:bg-zinc-800"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              aria-label="Table View"
              className={cn(
                "rounded-md p-1.5 transition-colors",
                viewMode === "table"
                  ? "bg-background text-foreground shadow-sm dark:bg-zinc-800"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: BROWSE STORED FILES (EXPLORER) */}
      {activeTab === "explorer" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60 space-y-3">
            {/* Category Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Asset Category:
              </span>
              {(
                [
                  ["all", "All Assets", counts.all],
                  ["recordings", "🎙️ Recordings", counts.recordings],
                  ["screenshots", "📸 Screenshots", counts.screenshots],
                  ["resumes", "📄 Resumes & CVs", counts.resumes],
                  ["raw", "📦 Raw S3 Files", counts.raw],
                ] as const
              ).map(([catKey, label, count]) => (
                <button
                  key={catKey}
                  type="button"
                  onClick={() => setCategory(catKey)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95 border",
                    category === catKey
                      ? "border-primary/50 bg-primary/10 text-primary dark:bg-primary/20 dark:border-primary/60 font-bold"
                      : "border-border/60 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:border-white/[0.08]",
                  )}
                >
                  <span>{label}</span>
                  <span className="rounded-full bg-muted/60 px-1.5 py-0.2 text-[10px] font-mono text-foreground">
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* Scope Filter Controls: Org, Project, and Search */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border/40 dark:border-white/[0.05]">
              {/* Organization Selector */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Organization
                </label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => {
                    setSelectedOrgId(e.target.value);
                    setSelectedProjectId("");
                  }}
                  className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:border-white/[0.08] dark:bg-zinc-900"
                >
                  <option value="">All Organizations (Global)</option>
                  {(index.data?.organizations ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Project Selector */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Project
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={availableProjects.length === 0}
                  className="w-full rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:border-white/[0.08] dark:bg-zinc-900 disabled:opacity-50"
                >
                  <option value="">
                    {selectedOrgId ? "All Projects in Organization" : "All Projects"}
                  </option>
                  {availableProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Query */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Search Stored Assets
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Candidate, file name, S3 key..."
                    className="w-full rounded-lg border border-border/70 bg-background pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:border-white/[0.08] dark:bg-zinc-900"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Asset List / Grid */}
          {filesQuery.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-44 rounded-xl border border-border/60 bg-card p-4 space-y-3 dark:border-white/[0.08]"
                >
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : (filesQuery.data?.items ?? []).length === 0 ? (
            <Panel>
              <EmptyState
                icon={HardDrive}
                title="No stored media files found"
                description={
                  searchQuery || selectedOrgId || selectedProjectId || category !== "all"
                    ? "Try adjusting your category, organization, or search query to find stored assets."
                    : "No interview recordings, proctoring screenshots, or resumes are currently saved in Backblaze B2."
                }
                action={
                  searchQuery || selectedOrgId || selectedProjectId || category !== "all" ? (
                    <TacticalButton
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCategory("all");
                        setSelectedOrgId("");
                        setSelectedProjectId("");
                        setSearchQuery("");
                      }}
                    >
                      Reset All Filters
                    </TacticalButton>
                  ) : undefined
                }
              />
            </Panel>
          ) : viewMode === "grid" ? (
            /* GRID VIEW */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filesQuery.data?.items.map((item) => (
                <div
                  key={item.id}
                  className="group relative flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 shadow-sm hover:border-primary/50 transition-all duration-200 dark:border-white/[0.08] dark:bg-zinc-950/70 hover:shadow-md"
                >
                  {/* Top Header Strip */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.category === "recording" ? (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20">
                            <Mic className="h-4 w-4" />
                          </div>
                        ) : item.category === "screenshot" ? (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        ) : item.category === "resume" ? (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 dark:bg-blue-500/20">
                            <FileText className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 dark:bg-amber-500/20">
                            <HardDrive className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-xs font-semibold text-foreground truncate"
                            title={item.name}
                          >
                            {item.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {item.candidateName || "Candidate Asset"}
                          </p>
                        </div>
                      </div>

                      <StatusPill
                        status={
                          item.category === "recording"
                            ? "ACTIVE"
                            : item.category === "screenshot"
                              ? "ONLINE"
                              : item.category === "resume"
                                ? "PENDING"
                                : "WARNING"
                        }
                        label={
                          item.category === "recording"
                            ? "Recording"
                            : item.category === "screenshot"
                              ? "Proctoring"
                              : item.category === "resume"
                                ? "Resume"
                                : "B2 Object"
                        }
                        className="text-[10px] px-2 py-0.5"
                      />
                    </div>

                    {/* Preview Area */}
                    <div className="pt-2">
                      {item.category === "screenshot" ? (
                        <div
                          onClick={() => setActivePreview(item)}
                          className="relative h-32 w-full overflow-hidden rounded-lg border border-border/50 bg-black/40 cursor-pointer group/img"
                        >
                          {item.signedUrl ? (
                            <img
                              src={item.signedUrl}
                              alt={item.name}
                              className="h-full w-full object-cover transition-transform duration-200 group-hover/img:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <ImageIcon className="h-6 w-6" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-medium">
                            <ZoomIn className="h-4 w-4" />
                            <span>Click to Inspect</span>
                          </div>
                        </div>
                      ) : item.category === "recording" ? (
                        <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 dark:border-white/[0.06] dark:bg-zinc-900/40 space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Play className="h-3 w-3 text-primary" />
                              Candidate Audio
                            </span>
                            <span className="font-mono text-[10px]">
                              {item.contentType || "audio/m4a"}
                            </span>
                          </div>
                          {item.signedUrl ? (
                            <audio
                              controls
                              src={item.signedUrl}
                              preload="none"
                              className="w-full h-8 accent-primary focus:outline-none"
                            />
                          ) : (
                            <p className="text-[11px] text-rose-500">
                              Signed URL not generated
                            </p>
                          )}
                        </div>
                      ) : item.category === "resume" ? (
                        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 dark:border-white/[0.06] dark:bg-zinc-900/40 flex items-center justify-between">
                          <div className="space-y-0.5 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">
                              {item.candidateEmail || "Attached CV Document"}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatBytes(item.size)}
                            </p>
                          </div>
                          {item.signedUrl && (
                            <a
                              href={item.signedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>View PDF</span>
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 dark:border-white/[0.06] dark:bg-zinc-900/40">
                          <p className="font-mono text-[11px] text-muted-foreground truncate">
                            {item.key}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Size: {formatBytes(item.size)}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Metadata Grid */}
                    <div className="pt-2 text-[11px] text-muted-foreground space-y-1">
                      {item.projectName && (
                        <div className="flex items-center gap-1.5 truncate">
                          <FolderGit2 className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                          <span className="truncate">
                            {item.projectName}{" "}
                            {item.organizationName ? `(${item.organizationName})` : ""}
                          </span>
                        </div>
                      )}
                      {item.createdAt && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                          <span>{formatDate(item.createdAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom Action Footer */}
                  <div className="pt-3 mt-3 border-t border-border/50 dark:border-white/[0.06] flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(item.key)}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy S3 Storage Key"
                    >
                      {copiedKey === item.key ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-500" />
                          <span className="text-emerald-500 font-medium">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span className="font-mono text-[10px] truncate max-w-[130px]">
                            {item.key.split("/").pop()}
                          </span>
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-1.5">
                      {item.signedUrl && (
                        <>
                          <a
                            href={item.signedUrl}
                            download={item.name}
                            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            title="Download Asset"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          <a
                            href={item.signedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            title="Open Direct URL"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* TABLE VIEW */
            <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider dark:border-white/[0.06] dark:bg-zinc-900/50">
                    <tr>
                      <th className="px-4 py-3">Asset & File Name</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Candidate / Subject</th>
                      <th className="px-4 py-3">Project & Org</th>
                      <th className="px-4 py-3">File Size</th>
                      <th className="px-4 py-3">Recorded / Uploaded</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 dark:divide-white/[0.04]">
                    {filesQuery.data?.items.map((item) => (
                      <tr
                        key={item.id}
                        className="hover:bg-muted/20 dark:hover:bg-zinc-900/30 transition-colors"
                      >
                        <td className="px-4 py-3 min-w-[200px]">
                          <div className="flex items-center gap-2.5">
                            {item.category === "recording" ? (
                              <Mic className="h-4 w-4 text-indigo-500 shrink-0" />
                            ) : item.category === "screenshot" ? (
                              <ImageIcon className="h-4 w-4 text-emerald-500 shrink-0" />
                            ) : item.category === "resume" ? (
                              <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                            ) : (
                              <HardDrive className="h-4 w-4 text-amber-500 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p
                                className="font-semibold text-foreground truncate max-w-[240px]"
                                title={item.name}
                              >
                                {item.name}
                              </p>
                              <p
                                className="font-mono text-[10px] text-muted-foreground truncate max-w-[240px]"
                                title={item.key}
                              >
                                {item.key}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            status={
                              item.category === "recording"
                                ? "ACTIVE"
                                : item.category === "screenshot"
                                  ? "ONLINE"
                                  : item.category === "resume"
                                    ? "PENDING"
                                    : "WARNING"
                            }
                            label={
                              item.category === "recording"
                                ? "Recording"
                                : item.category === "screenshot"
                                  ? "Screenshot"
                                  : item.category === "resume"
                                    ? "Resume"
                                    : "Object"
                            }
                            className="text-[10px] px-2 py-0.5"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {item.candidateName || "—"}
                            </p>
                            {item.candidateEmail && (
                              <p className="text-[11px] text-muted-foreground truncate">
                                {item.candidateEmail}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-foreground truncate">
                              {item.projectName || "—"}
                            </p>
                            {item.organizationName && (
                              <p className="text-[11px] text-muted-foreground truncate">
                                {item.organizationName}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                          {formatBytes(item.size)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(item.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.category === "screenshot" && (
                              <TacticalButton
                                variant="ghost"
                                size="sm"
                                onClick={() => setActivePreview(item)}
                                className="h-7 px-2 text-xs"
                                title="Inspect Image"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </TacticalButton>
                            )}
                            <TacticalButton
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(item.key)}
                              className="h-7 px-2 text-xs"
                              title="Copy S3 Key"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </TacticalButton>
                            {item.signedUrl && (
                              <>
                                <a
                                  href={item.signedUrl}
                                  download={item.name}
                                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                  title="Download"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </a>
                                <a
                                  href={item.signedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                  title="Open in new tab"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RETENTION & PRUNING */}
      {activeTab === "retention" && (
        <div className="space-y-6">
          {/* Scope Selector */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card p-1.5 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60 w-fit">
            {(
              [
                ["organizations", "Target Organizations", Building2],
                ["projects", "Target Projects", FolderGit2],
                ["all", "All Organizations (Global)", HardDrive],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95",
                  scope === value
                    ? "bg-primary text-white shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Selection Panel */}
          <Panel
            kicker="Pruning Scope"
            title={
              scope === "organizations"
                ? "Select Organizations to Purge"
                : scope === "projects"
                  ? "Select Specific Projects to Purge"
                  : "Global Instance Purge"
            }
            description={
              scope === "organizations"
                ? `${orgIds.length} of ${allOrgIds.length} organizations selected`
                : scope === "projects"
                  ? `${projectIds.length} of ${allProjIds.length} projects selected`
                  : "Warning: Will purge all media files across all organizations on this server instance."
            }
            actions={
              scope === "organizations" && allOrgIds.length > 0 ? (
                <div className="flex items-center gap-2">
                  <TacticalButton
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      orgIds.length === allOrgIds.length
                        ? clearSelection(setOrgIds)
                        : selectAll(allOrgIds, setOrgIds)
                    }
                  >
                    {orgIds.length === allOrgIds.length ? "Deselect All" : "Select All"}
                  </TacticalButton>
                </div>
              ) : scope === "projects" && allProjIds.length > 0 ? (
                <div className="flex items-center gap-2">
                  <TacticalButton
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      projectIds.length === allProjIds.length
                        ? clearSelection(setProjectIds)
                        : selectAll(allProjIds, setProjectIds)
                    }
                  >
                    {projectIds.length === allProjIds.length ? "Deselect All" : "Select All"}
                  </TacticalButton>
                </div>
              ) : null
            }
          >
            {index.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : scope === "organizations" ? (
              (index.data?.organizations ?? []).length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No organizations with stored files"
                  description="No tenant media files are currently tracked in the storage registry."
                />
              ) : (
                <ul className="divide-y divide-border/50 rounded-lg border border-border/60 overflow-hidden dark:divide-white/[0.05] dark:border-white/[0.06]">
                  {(index.data?.organizations ?? []).map((org) => {
                    const selected = orgIds.includes(org.id);
                    return (
                      <li
                        key={org.id}
                        onClick={() => toggle(orgIds, org.id, setOrgIds)}
                        className={cn(
                          "flex items-center gap-3.5 p-3.5 text-xs transition-colors cursor-pointer select-none",
                          selected
                            ? "bg-primary/[0.06] dark:bg-primary/[0.1]"
                            : "hover:bg-muted/30 dark:hover:bg-zinc-900/40",
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggle(orgIds, org.id, setOrgIds)}
                          aria-label={org.name}
                          className="data-[state=checked]:bg-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="font-heading font-semibold text-foreground text-sm">
                            {org.name}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : scope === "projects" ? (
              (index.data?.projects ?? []).length === 0 ? (
                <EmptyState
                  icon={FolderGit2}
                  title="No projects with stored files"
                  description="No project files found in the storage catalog."
                />
              ) : (
                <ul className="divide-y divide-border/50 rounded-lg border border-border/60 overflow-hidden dark:divide-white/[0.05] dark:border-white/[0.06]">
                  {(index.data?.projects ?? []).map((project) => {
                    const selected = projectIds.includes(project.id);
                    return (
                      <li
                        key={project.id}
                        onClick={() => toggle(projectIds, project.id, setProjectIds)}
                        className={cn(
                          "flex items-center gap-3.5 p-3.5 text-xs transition-colors cursor-pointer select-none",
                          selected
                            ? "bg-primary/[0.06] dark:bg-primary/[0.1]"
                            : "hover:bg-muted/30 dark:hover:bg-zinc-900/40",
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggle(projectIds, project.id, setProjectIds)}
                          aria-label={project.name}
                          className="data-[state=checked]:bg-primary"
                        />
                        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
                          <span className="font-heading font-semibold text-foreground text-sm">
                            {project.name}
                          </span>
                          <span className="text-muted-foreground text-xs font-mono">
                            ({orgNameMap.get(project.organizationId) ?? "Organization"})
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-xs font-medium text-amber-600 dark:text-amber-400 flex items-start gap-3">
                <AlertOctagon className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-sm">Global Purge Confirmation</p>
                  <p className="leading-relaxed">
                    This operation will permanently delete all raw recording assets across every single organization hosted on this ResilienceSoft Interview instance.
                  </p>
                </div>
              </div>
            )}

            {/* Delete Trigger Button */}
            <div className="pt-4 border-t border-border/50 dark:border-white/[0.06] mt-4 flex justify-end">
              <TacticalButton
                variant="destructive"
                disabled={!canDelete}
                onClick={() => setDeleteOpen(true)}
                className="gap-2 text-xs h-9"
              >
                <Trash2 className="h-4 w-4" />
                <span>
                  {scope === "all"
                    ? "Execute Global Purge"
                    : `Purge Stored Files (${scope === "organizations" ? orgIds.length : projectIds.length} Selected)`}
                </span>
              </TacticalButton>
            </div>
          </Panel>
        </div>
      )}

      {/* IMAGE / SCREENSHOT INSPECTION LIGHTBOX MODAL */}
      <Dialog
        open={!!activePreview}
        onOpenChange={(isOpen) => !isOpen && setActivePreview(null)}
      >
        <DialogContent className="max-w-4xl p-0 overflow-hidden border border-border/80 bg-zinc-950 text-white shadow-2xl">
          <DialogHeader className="p-4 border-b border-white/[0.08] bg-zinc-900/60">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-emerald-400" />
                  <span>{activePreview?.name}</span>
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-400 mt-0.5">
                  Proctoring capture for {activePreview?.candidateName || "Candidate"} (
                  {activePreview?.projectName || "Project"})
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                {activePreview?.signedUrl && (
                  <>
                    <a
                      href={activePreview.signedUrl}
                      download={activePreview.name}
                      className="rounded-lg border border-white/[0.1] bg-white/[0.05] p-1.5 text-zinc-300 hover:text-white hover:bg-white/[0.1] transition-colors"
                      title="Download image"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    <a
                      href={activePreview.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-white/[0.1] bg-white/[0.05] p-1.5 text-zinc-300 hover:text-white hover:bg-white/[0.1] transition-colors"
                      title="Open full size"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Full Image Canvas */}
          <div className="relative flex items-center justify-center bg-black/90 p-4 min-h-[360px] max-h-[70vh] overflow-auto">
            {activePreview?.signedUrl ? (
              <img
                src={activePreview.signedUrl}
                alt={activePreview.name}
                className="max-h-[65vh] w-auto max-w-full rounded-md object-contain shadow-lg"
              />
            ) : (
              <p className="text-xs text-zinc-400">Loading asset image...</p>
            )}
          </div>

          {/* Metadata Footer */}
          <div className="p-4 bg-zinc-900/80 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
            <div className="space-y-1 min-w-0">
              <p className="font-mono text-[11px] text-zinc-300 truncate max-w-lg">
                <span className="text-zinc-500">Path: </span>
                {activePreview?.key}
              </p>
              <div className="flex items-center gap-4 text-[11px]">
                {activePreview?.candidateEmail && (
                  <span>Email: {activePreview.candidateEmail}</span>
                )}
                {activePreview?.createdAt && (
                  <span>Captured: {formatDate(activePreview.createdAt)}</span>
                )}
              </div>
            </div>

            <TacticalButton
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(activePreview?.key || "")}
              className="text-xs border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200"
            >
              <Copy className="h-3.5 w-3.5 mr-1" />
              <span>Copy S3 Key</span>
            </TacticalButton>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal for Pruning */}
      <ConfirmAction
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete stored media files?"
        description={
          scope === "all"
            ? "Every audio/video recording and file stored in Backblaze B2 for this instance will be permanently erased. Interview scores and transcripts remain in the database."
            : scope === "organizations"
              ? `Files for ${orgIds.length} organization${orgIds.length === 1 ? "" : "s"} will be deleted. Transcripts and scores stay preserved.`
              : `Files for ${projectIds.length} project${projectIds.length === 1 ? "" : "s"} will be deleted. Transcripts and scores stay preserved.`
        }
        confirmLabel="Confirm & Delete Files"
        confirmText="delete files"
        confirmPlaceholder="Type delete files"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate({
            scope,
            organizationIds: scope === "organizations" ? orgIds : undefined,
            projectIds: scope === "projects" ? projectIds : undefined,
          })
        }
      />
    </div>
  );
}
