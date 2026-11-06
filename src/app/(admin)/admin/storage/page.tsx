"use client";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
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
        description: `${res.objects} file${res.objects === 1 ? "" : "s"} removed from ${res.sessions} session${res.sessions === 1 ? "" : "s"}. Scores were kept.`,
      });
      setOpen(false);
      setOrgIds([]);
      setProjectIds([]);
    },
    onError: (err) =>
      toast({ title: "Could not delete stored files", description: err.message, variant: "destructive" }),
  });

  const toggle = (list: string[], id: string, set: (next: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const canDelete =
    scope === "all" ||
    (scope === "organizations" && orgIds.length > 0) ||
    (scope === "projects" && projectIds.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Stored files</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Delete recordings and other files kept in Backblaze. Candidate scores and account records stay.
          Choose every organization, specific organizations, or specific projects.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All organizations"],
            ["organizations", "Organizations"],
            ["projects", "Projects"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={scope === value ? "default" : "outline"}
            onClick={() => setScope(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {index.isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : scope === "organizations" ? (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {(index.data?.organizations ?? []).map((org) => (
            <li key={org.id} className="flex items-center gap-3 px-4 py-3">
              <Checkbox
                checked={orgIds.includes(org.id)}
                onCheckedChange={() => toggle(orgIds, org.id, setOrgIds)}
                aria-label={org.name}
              />
              <span className="text-sm">{org.name}</span>
            </li>
          ))}
        </ul>
      ) : scope === "projects" ? (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {(index.data?.projects ?? []).map((project) => (
            <li key={project.id} className="flex items-center gap-3 px-4 py-3">
              <Checkbox
                checked={projectIds.includes(project.id)}
                onCheckedChange={() => toggle(projectIds, project.id, setProjectIds)}
                aria-label={project.name}
              />
              <span className="min-w-0 flex-1 text-sm">
                {project.name}
                <span className="ml-2 text-xs text-muted-foreground">{orgName(project.organizationId)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          This deletes stored files for every organization on this server.
        </p>
      )}

      <Button variant="destructive" disabled={!canDelete} onClick={() => setOpen(true)}>
        Delete stored files
      </Button>

      <ConfirmAction
        open={open}
        onOpenChange={setOpen}
        title="Delete stored files?"
        description={
          scope === "all"
            ? "Every recording and file in Backblaze for this server is deleted. Scores stay in the database."
            : scope === "organizations"
              ? `Files for ${orgIds.length} organization${orgIds.length === 1 ? "" : "s"} are deleted. Scores stay.`
              : `Files for ${projectIds.length} project${projectIds.length === 1 ? "" : "s"} are deleted. Scores stay.`
        }
        confirmLabel="Delete stored files"
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
