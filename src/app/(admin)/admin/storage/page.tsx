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
import {
  CapacityOverview,
  UsageBreakdown,
} from "@/components/admin/storage-usage-panel";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  AlertOctagon,
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  Clock,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderSync,
  Grid,
  HardDrive,
  Image as ImageIcon,
  Layers,
  List,
  Mic,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  User,
  X,
  ZoomIn,
} from "lucide-react";

type Scope = "all" | "organizations" | "projects";
type CategoryFilter = "all" | "recordings" | "screenshots" | "resumes" | "raw";
type SubfolderFilter = "all" | "recordings" | "images" | "cv";
type ExplorerMode = "folder_tree" | "candidate_dossiers" | "flat_table";

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
  const [activeTab, setActiveTab] = useState<"explorer" | "usage" | "retention">("explorer");

  // Explorer visualization mode: folder_tree, candidate_dossiers, flat_table
  const [explorerMode, setExplorerMode] = useState<ExplorerMode>("folder_tree");

  // Directory drill-down state
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [selectedSubfolder, setSelectedSubfolder] = useState<SubfolderFilter>("all");

  // Telemetry queries
  const statsQuery = trpc.platform.storageStats.useQuery(undefined, {
    staleTime: 30_000,
  });

  // Real occupied / remaining space and per-org / per-candidate breakdown
  const usageQuery = trpc.platform.storageUsage.useQuery(undefined, {
    staleTime: 30_000,
  });

  // Storage index for org and project dropdowns
  const index = trpc.platform.storageIndex.useQuery(undefined, {
    staleTime: 60_000,
  });

  // Explorer filters & search
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

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
      limit: 150,
    },
    {
      staleTime: 20_000,
    },
  );

  // Reorganize / migrate storage folders mutation
  const reorganizeMutation = trpc.platform.reorganizeStoredFiles.useMutation({
    onSuccess: (res) => {
      toast({
        title: res.migratedCount === 0 ? "Folders already clean" : "Candidate folders merged",
        description:
          res.migratedCount === 0
            ? "Every candidate already has a single folder."
            : `Moved ${res.migratedCount} file${res.migratedCount === 1 ? "" : "s"} (${formatBytes(res.bytesMoved)}) out of ${res.foldersMerged} duplicate folder${res.foldersMerged === 1 ? "" : "s"}; updated ${res.sessionsUpdated} session${res.sessionsUpdated === 1 ? "" : "s"} and ${res.candidatesUpdated} CV link${res.candidatesUpdated === 1 ? "" : "s"}.${res.failed ? ` ${res.failed} file(s) could not be moved.` : ""}`,
        variant: res.failed ? "destructive" : undefined,
      });
      filesQuery.refetch();
      statsQuery.refetch();
      usageQuery.refetch();
    },
    onError: (err) => {
      toast({
        title: "Could not reorganize folders",
        description: err.message,
        variant: "destructive",
      });
    },
  });

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
      title: "Storage path copied",
      description: text,
    });
  };

  // Retention delete mutation
  const remove = trpc.platform.deleteStoredFiles.useMutation({
    onSuccess: (res) => {
      toast({
        title: "Stored files deleted",
        description: `${res.objects} file${res.objects === 1 ? "" : "s"} removed, ${formatBytes(res.bytes)} freed, from ${res.sessions} session${res.sessions === 1 ? "" : "s"}. Candidate scores were preserved.`,
      });
      setDeleteOpen(false);
      setOrgIds([]);
      setProjectIds([]);
      filesQuery.refetch();
      statsQuery.refetch();
      usageQuery.refetch();
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

  // How much space the current selection will free (shown before confirming)
  const previewInput = {
    scope,
    organizationIds: scope === "organizations" ? orgIds : undefined,
    projectIds: scope === "projects" ? projectIds : undefined,
  } as const;
  const deletePreview = trpc.platform.storageDeletePreview.useQuery(previewInput, {
    enabled: activeTab === "retention" && canDelete,
    staleTime: 10_000,
  });
  const orgSizeMap = useMemo(
    () => new Map((usageQuery.data?.organizations ?? []).map((o) => [o.id, o])),
    [usageQuery.data?.organizations],
  );
  const projectSizeMap = useMemo(() => {
    const m = new Map<string, { bytes: number; files: number }>();
    for (const o of usageQuery.data?.organizations ?? []) {
      for (const p of o.projects) m.set(p.id, p);
    }
    return m;
  }, [usageQuery.data?.organizations]);

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

  const candidateFolders = filesQuery.data?.candidateFolders || [];

  // Currently active candidate folder in drill-down mode
  const currentCandidateFolder = useMemo(() => {
    if (!selectedCandidateKey) return null;
    return candidateFolders.find(
      (c) =>
        c.groupKey === selectedCandidateKey,
    );
  }, [candidateFolders, selectedCandidateKey]);

  // Files to display inside the drilled-down candidate folder
  const currentDrilledFiles = useMemo(() => {
    if (!currentCandidateFolder) return [];
    if (selectedSubfolder === "recordings") return currentCandidateFolder.recordings;
    if (selectedSubfolder === "images") return currentCandidateFolder.images;
    if (selectedSubfolder === "cv") return currentCandidateFolder.cv;
    return [
      ...currentCandidateFolder.recordings,
      ...currentCandidateFolder.images,
      ...currentCandidateFolder.cv,
      ...currentCandidateFolder.raw,
    ];
  }, [currentCandidateFolder, selectedSubfolder]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        kicker="Backblaze B2 & Object Store"
        title="Stored Files & Media Explorer"
        description="Structured folder hierarchy (candidateName/recordings, /images, /CV). Play interview recordings, inspect proctoring captures, and view candidate resumes directly from Backblaze B2."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TacticalButton
              variant="outline"
              size="sm"
              onClick={() =>
                reorganizeMutation.mutate({
                  organizationId: selectedOrgId || undefined,
                  projectId: selectedProjectId || undefined,
                })
              }
              className="gap-1.5 text-xs h-8 border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary"
              disabled={reorganizeMutation.isPending}
            >
              <FolderSync
                className={cn(
                  "h-3.5 w-3.5",
                  reorganizeMutation.isPending && "animate-spin text-primary",
                )}
              />
              <span>
                {reorganizeMutation.isPending
                  ? "Organizing B2 Folders..."
                  : "Organize B2 Folders"}
              </span>
            </TacticalButton>

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
          title="Candidate Audio / Video"
          value={counts.recordings}
          subtitle={`${formatBytes(filesQuery.data?.bytes.recordings)} • candidateName/recordings`}
          trend="Streamable"
          trendDirection="neutral"
          icon={Mic}
        />
        <StatCard
          title="Proctoring Images"
          value={counts.screenshots}
          subtitle={`${formatBytes(filesQuery.data?.bytes.screenshots)} • candidateName/images`}
          trend="Indexed"
          trendDirection="neutral"
          icon={ImageIcon}
        />
        <StatCard
          title="Candidate Resumes & CVs"
          value={counts.resumes}
          subtitle={`${formatBytes(filesQuery.data?.bytes.resumes)} • candidateName/CV`}
          trend="Structured"
          trendDirection="neutral"
          icon={FileText}
        />
      </div>

      <CapacityOverview
        usage={usageQuery.data}
        loading={usageQuery.isLoading}
        onQuotaSaved={() => usageQuery.refetch()}
      />

      {/* Main Mode Navigation Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-3 dark:border-white/[0.08]">
        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card p-1 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60">
          <button
            type="button"
            onClick={() => {
              setActiveTab("explorer");
              setSelectedCandidateKey(null);
            }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95",
              activeTab === "explorer"
                ? "bg-primary text-white shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>Folderized Storage Explorer</span>
            <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-mono">
              {candidateFolders.length} Folders
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("usage")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95",
              activeTab === "usage"
                ? "bg-primary text-white shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HardDrive className="h-3.5 w-3.5" />
            <span>Usage by Org & Candidate</span>
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
          <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-1 dark:border-white/[0.08] dark:bg-zinc-900/50">
            <button
              type="button"
              onClick={() => {
                setExplorerMode("folder_tree");
                setSelectedCandidateKey(null);
              }}
              title="Folder Directory View"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                explorerMode === "folder_tree"
                  ? "bg-background text-foreground shadow-sm dark:bg-zinc-800 font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Folder className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Folder Directory</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setExplorerMode("candidate_dossiers");
                setSelectedCandidateKey(null);
              }}
              title="Candidate Dossiers View"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                explorerMode === "candidate_dossiers"
                  ? "bg-background text-foreground shadow-sm dark:bg-zinc-800 font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Candidate Dossiers</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setExplorerMode("flat_table");
                setSelectedCandidateKey(null);
              }}
              title="Flat Asset Table"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                explorerMode === "flat_table"
                  ? "bg-background text-foreground shadow-sm dark:bg-zinc-800 font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Flat Table</span>
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: BROWSE STORED FILES (EXPLORER) */}
      {activeTab === "explorer" && (
        <div className="space-y-4">
          {/* Scope & Search Filter Bar */}
          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60 space-y-3">
            {/* Category Filter Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Folder Filter:
              </span>
              {(
                [
                  ["all", "All Folders & Files", counts.all],
                  ["recordings", "📁 recordings/", counts.recordings],
                  ["screenshots", "📁 images/", counts.screenshots],
                  ["resumes", "📁 CV/", counts.resumes],
                  ["raw", "📦 Raw B2 Objects", counts.raw],
                ] as const
              ).map(([catKey, label, count]) => (
                <button
                  key={catKey}
                  type="button"
                  onClick={() => {
                    setCategory(catKey);
                    setSelectedSubfolder("all");
                  }}
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
                    setSelectedCandidateKey(null);
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
                  onChange={(e) => {
                    setSelectedProjectId(e.target.value);
                    setSelectedCandidateKey(null);
                  }}
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
                  Search Candidate or Folder
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSelectedCandidateKey(null);
                    }}
                    placeholder="Candidate name, email, folder, key..."
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

          {/* FOLDER DIRECTORY BREADCRUMB BAR */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3.5 py-2 text-xs text-muted-foreground dark:border-white/[0.06] dark:bg-zinc-900/40">
            <div className="flex flex-wrap items-center gap-1.5 font-mono">
              <button
                type="button"
                onClick={() => {
                  setSelectedCandidateKey(null);
                  setSelectedSubfolder("all");
                }}
                className="flex items-center gap-1 text-primary hover:underline font-semibold"
              >
                <HardDrive className="h-3.5 w-3.5" />
                <span>b2://{storageConfig?.bucket || "skillmark"}</span>
              </button>

              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
              <span>candidates</span>

              {currentCandidateFolder && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <button
                    type="button"
                    onClick={() => setSelectedSubfolder("all")}
                    className={cn(
                      "flex items-center gap-1 hover:underline font-semibold",
                      selectedSubfolder === "all" ? "text-foreground font-bold" : "text-primary",
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 text-amber-500" />
                    <span>{currentCandidateFolder.candidateName}</span>
                  </button>
                </>
              )}

              {currentCandidateFolder && selectedSubfolder !== "all" && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span className="flex items-center gap-1 text-foreground font-bold">
                    <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                    <span>{selectedSubfolder}/</span>
                  </span>
                </>
              )}
            </div>

            {currentCandidateFolder && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCandidateKey(null)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back to all folders</span>
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(currentCandidateFolder.folderPath)}
                  className="flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Copy className="h-3 w-3" />
                  <span>Copy Folder Path</span>
                </button>
              </div>
            )}
          </div>

          {/* MAIN EXPLORER DISPLAY */}
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
          ) : candidateFolders.length === 0 ? (
            <Panel>
              <EmptyState
                icon={Folder}
                title="No candidate storage folders found"
                description={
                  searchQuery || selectedOrgId || selectedProjectId || category !== "all"
                    ? "Try adjusting your category, organization, or search query to find candidate folders."
                    : "No candidate recordings, proctoring images, or resumes are currently saved in Backblaze B2."
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
                        setSelectedCandidateKey(null);
                      }}
                    >
                      Reset All Filters
                    </TacticalButton>
                  ) : undefined
                }
              />
            </Panel>
          ) : currentCandidateFolder ? (
            /* DRILLED DOWN INTO A CANDIDATE FOLDER */
            <div className="space-y-4">
              {/* Subfolder tabs inside this candidate */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card p-3 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60">
                <span className="text-xs font-semibold text-muted-foreground mr-2">
                  Subfolder:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSubfolder("all")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                    selectedSubfolder === "all"
                      ? "bg-primary text-white shadow-sm"
                      : "bg-muted/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Folder className="h-3.5 w-3.5" />
                  <span>All Files</span>
                  <span className="rounded-full bg-black/20 px-1.5 text-[10px]">
                    {currentCandidateFolder.totalFiles}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSubfolder("recordings")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                    selectedSubfolder === "recordings"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-muted/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Mic className="h-3.5 w-3.5" />
                  <span>📁 recordings/</span>
                  <span className="rounded-full bg-black/20 px-1.5 text-[10px]">
                    {currentCandidateFolder.recordings.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSubfolder("images")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                    selectedSubfolder === "images"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-muted/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>📁 images/</span>
                  <span className="rounded-full bg-black/20 px-1.5 text-[10px]">
                    {currentCandidateFolder.images.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSubfolder("cv")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                    selectedSubfolder === "cv"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-muted/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>📁 CV/</span>
                  <span className="rounded-full bg-black/20 px-1.5 text-[10px]">
                    {currentCandidateFolder.cv.length}
                  </span>
                </button>
              </div>

              {/* Files in selected subfolder */}
              {currentDrilledFiles.length === 0 ? (
                <Panel>
                  <EmptyState
                    icon={FolderOpen}
                    title={`No files in ${selectedSubfolder === "all" ? "this folder" : selectedSubfolder + "/"}`}
                    description="No files currently saved under this specific candidate folder."
                  />
                </Panel>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {currentDrilledFiles.map((item) => (
                    <div
                      key={item.id}
                      className="group relative flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 shadow-sm hover:border-primary/50 transition-all duration-200 dark:border-white/[0.08] dark:bg-zinc-950/70 hover:shadow-md"
                    >
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
                              <p className="font-mono text-[10px] text-muted-foreground truncate">
                                {item.key.split("/").slice(-2).join("/")}
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
                                ? "recordings/"
                                : item.category === "screenshot"
                                  ? "images/"
                                  : item.category === "resume"
                                    ? "CV/"
                                    : "raw"
                            }
                            className="text-[10px] px-2 py-0.5"
                          />
                        </div>

                        {/* Preview Asset Area */}
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
                                  Candidate Recording
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
                                  {item.candidateEmail || "Candidate Resume"}
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
                                  <span>View CV</span>
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

                        {/* Metadata Footer */}
                        <div className="pt-2 text-[11px] text-muted-foreground space-y-1">
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
              )}
            </div>
          ) : explorerMode === "folder_tree" ? (
            /* FOLDER DIRECTORY VIEW (CARDS PER CANDIDATE WITH SUBFOLDER PILLS) */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {candidateFolders.map((cand) => (
                <div
                  key={cand.groupKey}
                  className="group relative flex flex-col justify-between rounded-xl border border-border/70 bg-card p-4 shadow-sm hover:border-primary/60 transition-all duration-200 dark:border-white/[0.08] dark:bg-zinc-950/70 hover:shadow-md cursor-pointer"
                  onClick={() => setSelectedCandidateKey(cand.groupKey)}
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 dark:bg-amber-500/20 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                          <Folder className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                            {cand.candidateName}
                          </h4>
                          <p className="text-[11px] text-muted-foreground truncate font-mono">
                            {cand.folderSlug}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">
                          {cand.totalFiles} files
                        </span>
                        {cand.duplicateFolders > 0 && (
                          <span
                            className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[10px] font-semibold"
                            title={cand.folderPaths.join("\n")}
                          >
                            {cand.folderPaths.length} folders — merge
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Subfolder pills inside the card */}
                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCandidateKey(cand.groupKey);
                          setSelectedSubfolder("recordings");
                        }}
                        className="rounded-lg border border-border/60 bg-muted/30 p-2 text-center hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-colors dark:border-white/[0.06]"
                      >
                        <Mic className="h-3.5 w-3.5 mx-auto text-indigo-500 mb-1" />
                        <p className="text-[10px] font-semibold text-foreground truncate">
                          recordings/
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {cand.recordings.length} • {formatBytes(cand.recordingsBytes)}
                        </p>
                      </div>

                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCandidateKey(cand.groupKey);
                          setSelectedSubfolder("images");
                        }}
                        className="rounded-lg border border-border/60 bg-muted/30 p-2 text-center hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors dark:border-white/[0.06]"
                      >
                        <ImageIcon className="h-3.5 w-3.5 mx-auto text-emerald-500 mb-1" />
                        <p className="text-[10px] font-semibold text-foreground truncate">
                          images/
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {cand.images.length} • {formatBytes(cand.imagesBytes)}
                        </p>
                      </div>

                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCandidateKey(cand.groupKey);
                          setSelectedSubfolder("cv");
                        }}
                        className="rounded-lg border border-border/60 bg-muted/30 p-2 text-center hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors dark:border-white/[0.06]"
                      >
                        <FileText className="h-3.5 w-3.5 mx-auto text-blue-500 mb-1" />
                        <p className="text-[10px] font-semibold text-foreground truncate">
                          CV/
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {cand.cv.length} • {formatBytes(cand.cvBytes)}
                        </p>
                      </div>
                    </div>

                    {/* Metadata Strip */}
                    <div className="pt-1 text-[11px] text-muted-foreground space-y-1">
                      {cand.projectName && (
                        <div className="flex items-center gap-1.5 truncate">
                          <FolderGit2 className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                          <span className="truncate">
                            {cand.projectName}{" "}
                            {cand.organizationName ? `(${cand.organizationName})` : ""}
                          </span>
                        </div>
                      )}
                      {cand.candidateEmail && (
                        <div className="flex items-center gap-1.5 truncate">
                          <User className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                          <span className="truncate">{cand.candidateEmail}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="pt-3 mt-3 border-t border-border/50 dark:border-white/[0.06] flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-mono text-[10px]">
                      {formatBytes(cand.totalSizeBytes)}
                    </span>
                    <span className="flex items-center gap-1 text-primary font-medium group-hover:translate-x-0.5 transition-transform">
                      <span>Open Folder</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : explorerMode === "candidate_dossiers" ? (
            /* CANDIDATE DOSSIERS (EXPANDED CANDIDATE CARDS WITH INLINE MEDIA) */
            <div className="space-y-4">
              {candidateFolders.map((cand) => (
                <div
                  key={cand.groupKey}
                  className="rounded-xl border border-border/70 bg-card p-5 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/70 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3 dark:border-white/[0.06]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 dark:bg-amber-500/20">
                        <Folder className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {cand.candidateName}
                        </h4>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {cand.folderPath} • {formatBytes(cand.totalSizeBytes)}
                          {cand.duplicateFolders > 0
                            ? ` • ${cand.folderPaths.length} physical folders`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(cand.folderPath)}
                        className="flex items-center gap-1 rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copy Folder Path</span>
                      </button>
                    </div>
                  </div>

                  {/* 3 Folders Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* recordings/ */}
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2 dark:border-white/[0.05]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold flex items-center gap-1.5 text-indigo-400">
                          <Mic className="h-3.5 w-3.5" />
                          <span>recordings/</span>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {cand.recordings.length} files
                        </span>
                      </div>
                      {cand.recordings.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">No recordings</p>
                      ) : (
                        <div className="space-y-2">
                          {cand.recordings.map((rec) => (
                            <div
                              key={rec.id}
                              className="rounded border border-border/50 bg-background/60 p-2 space-y-1.5 dark:border-white/[0.06]"
                            >
                              <p className="text-[11px] font-medium truncate">{rec.name}</p>
                              {rec.signedUrl && (
                                <audio
                                  controls
                                  src={rec.signedUrl}
                                  preload="none"
                                  className="w-full h-7 accent-primary"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* images/ */}
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2 dark:border-white/[0.05]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold flex items-center gap-1.5 text-emerald-400">
                          <ImageIcon className="h-3.5 w-3.5" />
                          <span>images/</span>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {cand.images.length} files
                        </span>
                      </div>
                      {cand.images.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">No proctoring images</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-1.5">
                          {cand.images.slice(0, 6).map((img) => (
                            <div
                              key={img.id}
                              onClick={() => setActivePreview(img)}
                              className="relative h-14 rounded overflow-hidden border border-border/50 bg-black/40 cursor-pointer group/thumb"
                            >
                              {img.signedUrl && (
                                <img
                                  src={img.signedUrl}
                                  alt={img.name}
                                  className="h-full w-full object-cover transition-transform group-hover/thumb:scale-105"
                                  loading="lazy"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* CV/ */}
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2 dark:border-white/[0.05]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold flex items-center gap-1.5 text-blue-400">
                          <FileText className="h-3.5 w-3.5" />
                          <span>CV/</span>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {cand.cv.length} files
                        </span>
                      </div>
                      {cand.cv.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">No resumes attached</p>
                      ) : (
                        <div className="space-y-2">
                          {cand.cv.map((doc) => (
                            <div
                              key={doc.id}
                              className="flex items-center justify-between rounded border border-border/50 bg-background/60 p-2 dark:border-white/[0.06]"
                            >
                              <div className="min-w-0 pr-2">
                                <p className="text-[11px] font-medium truncate">{doc.name}</p>
                                <p className="text-[10px] text-muted-foreground">{formatBytes(doc.size)}</p>
                              </div>
                              {doc.signedUrl && (
                                <a
                                  href={doc.signedUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/20"
                                >
                                  View
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* FLAT TABLE VIEW */
            <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider dark:border-white/[0.06] dark:bg-zinc-900/50">
                    <tr>
                      <th className="px-4 py-3">Asset & File Name</th>
                      <th className="px-4 py-3">Folder Path</th>
                      <th className="px-4 py-3">Candidate</th>
                      <th className="px-4 py-3">Project & Org</th>
                      <th className="px-4 py-3">Size</th>
                      <th className="px-4 py-3">Created</th>
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
                        <td className="px-4 py-3 font-mono text-[11px]">
                          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-foreground">
                            {item.category === "recording"
                              ? "recordings/"
                              : item.category === "screenshot"
                                ? "images/"
                                : item.category === "resume"
                                  ? "CV/"
                                  : "raw"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground truncate">
                            {item.candidateName || "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-foreground truncate">{item.projectName || "—"}</p>
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
                              <a
                                href={item.signedUrl}
                                download={item.name}
                                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                title="Download"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
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

      {/* TAB 2: USAGE BREAKDOWN */}
      {activeTab === "usage" && (
        <UsageBreakdown usage={usageQuery.data} loading={usageQuery.isLoading} />
      )}

      {/* TAB 3: RETENTION & PRUNING */}
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
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {orgSizeMap.get(org.id)?.files ?? 0} files •{" "}
                          <b className="text-foreground">
                            {formatBytes(orgSizeMap.get(org.id)?.bytes ?? 0)}
                          </b>
                        </span>
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
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {projectSizeMap.get(project.id)?.files ?? 0} files •{" "}
                          <b className="text-foreground">
                            {formatBytes(projectSizeMap.get(project.id)?.bytes ?? 0)}
                          </b>
                        </span>
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
            <div className="pt-4 border-t border-border/50 dark:border-white/[0.06] mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {!canDelete ? (
                  "Select what to delete to see how much space will be freed."
                ) : deletePreview.isLoading ? (
                  "Calculating space to free…"
                ) : deletePreview.data ? (
                  <>
                    This will free{" "}
                    <b className="text-foreground text-sm">{formatBytes(deletePreview.data.bytes)}</b>{" "}
                    ({deletePreview.data.objects.toLocaleString()} file
                    {deletePreview.data.objects === 1 ? "" : "s"}).
                  </>
                ) : null}
              </p>
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
                <span className="text-zinc-500">Folder Path: </span>
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
          (deletePreview.data
            ? `This will free ${formatBytes(deletePreview.data.bytes)} (${deletePreview.data.objects.toLocaleString()} files). `
            : "") +
          (scope === "all"
            ? "Every audio/video recording and file stored in Backblaze B2 for this instance will be permanently erased. Interview scores and transcripts remain in the database."
            : scope === "organizations"
              ? `Files for ${orgIds.length} organization${orgIds.length === 1 ? "" : "s"} will be deleted. Transcripts and scores stay preserved.`
              : `Files for ${projectIds.length} project${projectIds.length === 1 ? "" : "s"} will be deleted. Transcripts and scores stay preserved.`)
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
