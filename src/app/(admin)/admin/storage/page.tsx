"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import {
  EmptyState,
  PageHeader,
  Panel,
  TacticalButton,
} from "@/components/admin/admin-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  AlertOctagon,
  Building2,
  FolderGit2,
  HardDrive,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

type Scope = "all" | "organizations" | "projects";

export default function AdminStoragePage() {
  const { toast } = useToast();
  const index = trpc.platform.storageIndex.useQuery(undefined, { staleTime: 15_000 });
  const [scope, setScope] = useState<Scope>("organizations");
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const orgName = useMemo(() => {
    const map = new Map((index.data?.organizations ?? []).map((o) => [o.id, o.name]));
    return (id: string) => map.get(id) ?? "Organization";
  }, [index.data?.organizations]);

  const remove = trpc.platform.deleteStoredFiles.useMutation({
    onSuccess: (res) => {
      toast({
        title: "Stored files deleted",
        description: `${res.objects} file${res.objects === 1 ? "" : "s"} removed from ${res.sessions} session${res.sessions === 1 ? "" : "s"}. Candidate scores were preserved.`,
      });
      setOpen(false);
      setOrgIds([]);
      setProjectIds([]);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        kicker="Retention & Pruning"
        title="Stored Media & Recordings"
        description="Permanently purge raw audio/video recordings and intermediate files stored in Backblaze B2. Candidate performance reports and database scorecards remain intact."
      />

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
                        ({orgName(project.organizationId)})
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
            onClick={() => setOpen(true)}
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

      {/* Confirmation Modal */}
      <ConfirmAction
        open={open}
        onOpenChange={setOpen}
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
