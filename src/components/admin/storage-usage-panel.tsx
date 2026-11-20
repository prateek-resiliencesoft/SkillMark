"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertTriangle, ChevronDown, ChevronRight, Pencil, Users } from "lucide-react";
import { EmptyState, Panel } from "@/components/admin/admin-ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppRouter } from "@/server/routers/_app";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export type StorageUsage = inferRouterOutputs<AppRouter>["platform"]["storageUsage"];

export function formatSize(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2))} ${units[i]}`;
}

function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60 dark:bg-white/[0.06]">
      <div
        className={cn("h-full rounded-full bg-primary", className)}
        style={{ width: `${Math.max(pct > 0 ? 1.5 : 0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

type CapLevel = "ok" | "warn80" | "warn95" | "full";

/** Amber at 80%, red at 95%, blocking notice at 100% of the super-admin storage cap. */
export function StorageCapBanner({
  level,
  usedBytes,
  quotaBytes,
  percent,
}: {
  level: CapLevel;
  usedBytes: number;
  quotaBytes: number | null;
  percent: number | null;
}) {
  if (level === "ok" || !quotaBytes) return null;
  const pct = percent != null ? `${percent}%` : "";
  const text =
    level === "full"
      ? `Storage cap reached (${formatSize(usedBytes)} of ${formatSize(quotaBytes)}). New uploads such as CVs and attachments are refused; interviews already running can still save their media. Raise the cap or free up space.`
      : level === "warn95"
        ? `Storage is ${pct} full (${formatSize(usedBytes)} of ${formatSize(quotaBytes)}). Uploads stop at 100%.`
        : `Storage is ${pct} full (${formatSize(usedBytes)} of ${formatSize(quotaBytes)}).`;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-3 text-sm",
        level === "warn80"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className={cn(level === "full" && "font-medium")}>{text}</p>
    </div>
  );
}

/** Self-loading cap banner for pages outside the storage explorer (super-admin dashboard). */
export function StorageCapAlert() {
  const q = trpc.platform.storageCapStatus.useQuery(undefined, { staleTime: 60_000 });
  if (!q.data) return null;
  return <StorageCapBanner {...q.data} />;
}

/** Used / free overview shown above the explorer. */
export function CapacityOverview({
  usage,
  loading,
  onQuotaSaved,
}: {
  usage?: StorageUsage;
  loading: boolean;
  onQuotaSaved?: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [gb, setGb] = useState("");
  const saveQuota = trpc.platform.setStorageQuota.useMutation({
    onSuccess: () => {
      setEditing(false);
      toast({ title: "Storage cap saved" });
      onQuotaSaved?.();
    },
    onError: (err) =>
      toast({ title: "Could not save limit", description: err.message, variant: "destructive" }),
  });
  if (loading || !usage) {
    return <Skeleton className="h-28 w-full rounded-xl" />;
  }
  const { capacity, usedBytes } = usage;
  const total = capacity.totalBytes;
  const pct = total ? (usedBytes / total) * 100 : 0;
  const cats = [
    ["Recordings", usage.byCategory.recordings, "bg-indigo-500"],
    ["Proctoring images", usage.byCategory.images, "bg-emerald-500"],
    ["CVs / resumes", usage.byCategory.cv, "bg-blue-500"],
    ["Other", usage.byCategory.other, "bg-amber-500"],
  ] as const;
  const tenantTotal = Math.max(1, usage.tenantBytes);
  const level = capacity.level;

  return (
    <div className="space-y-3">
    {capacity.source === "quota" && (
      <StorageCapBanner
        level={level}
        usedBytes={usedBytes}
        quotaBytes={capacity.totalBytes}
        percent={capacity.percent}
      />
    )}
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm dark:border-white/[0.08] dark:bg-zinc-950/60 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Storage occupied
          </p>
          <p className="font-heading text-2xl font-semibold text-foreground">
            {formatSize(usedBytes)}
            {total ? (
              <span className="ml-2 text-sm font-medium text-muted-foreground">
                of {formatSize(total)}
              </span>
            ) : null}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {usage.usedObjects.toLocaleString()} files stored
            {" "}on this server
            {usage.outsideTenantBytes > 0
              ? ` • ${formatSize(usage.outsideTenantBytes)} outside candidate folders`
              : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Remaining
          </p>
          <p
            className={cn(
              "font-heading text-2xl font-semibold",
              capacity.freeBytes != null ? "text-emerald-500" : "text-muted-foreground",
            )}
          >
            {capacity.freeBytes != null ? formatSize(capacity.freeBytes) : "Limit not set"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {capacity.source === "disk"
              ? "Free space on the server disk (no storage cap set)"
              : capacity.source === "quota"
                ? `${pct.toFixed(1)}% of the ${formatSize(total)} storage cap used${
                    capacity.limitFrom === "env" ? " (from server config)" : ""
                  }`
                : "No storage cap set."}
          </p>
          {capacity.diskFreeBytes != null && capacity.source === "quota" && (
            <p className="text-[11px] text-muted-foreground">
              Server disk: {formatSize(capacity.diskFreeBytes)} free of {formatSize(capacity.diskTotalBytes)}
            </p>
          )}
          {editing ? (
              <form
                className="mt-1.5 flex items-center justify-end gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(gb);
                  if (Number.isFinite(n) && n > 0) saveQuota.mutate({ gb: n });
                }}
              >
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="any"
                  value={gb}
                  onChange={(e) => setGb(e.target.value)}
                  placeholder="Max size"
                  className="w-24 rounded-md border border-border/70 bg-background px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-zinc-900"
                />
                <span className="text-[11px] text-muted-foreground">GB</span>
                <button
                  type="submit"
                  disabled={saveQuota.isPending}
                  className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                >
                  Save
                </button>
                {capacity.limitFrom === "admin" && (
                  <button
                    type="button"
                    disabled={saveQuota.isPending}
                    onClick={() => saveQuota.mutate({ gb: null })}
                    className="rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setGb(total ? String(+(total / 1024 ** 3).toFixed(2)) : "");
                  setEditing(true);
                }}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <Pencil className="h-3 w-3" />
                {capacity.limitFrom ? "Edit storage cap" : "Set storage cap (GB)"}
              </button>
            )}
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Maximum storage for media on this server. Warns at 80% and 95%, blocks new uploads at 100%.
          </p>
        </div>
      </div>

      {total ? (
        <Bar
          pct={pct}
          className={level === "full" || level === "warn95" ? "bg-rose-500" : level === "warn80" ? "bg-amber-500" : ""}
        />
      ) : null}

      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/50 dark:bg-white/[0.05]">
        {cats.map(([label, c, color]) => (
          <div
            key={label}
            className={color}
            style={{ width: `${(c.bytes / tenantTotal) * 100}%` }}
            title={`${label}: ${formatSize(c.bytes)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        {cats.map(([label, c, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", color)} />
            {label}: <b className="text-foreground">{formatSize(c.bytes)}</b>
            <span className="font-mono">({c.files})</span>
          </span>
        ))}
      </div>
    </div>
    </div>
  );
}

/** Who is using the space: organizations → projects, plus the biggest candidates. */
export function UsageBreakdown({ usage, loading }: { usage?: StorageUsage; loading: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (loading || !usage) return <Skeleton className="h-64 w-full rounded-xl" />;

  const maxOrg = Math.max(1, ...usage.organizations.map((o) => o.bytes));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      {(usage.duplicateFolders > 0 || usage.unlinkedFolders > 0) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
          {usage.duplicateFolders > 0 && (
            <p>
              <b>{usage.duplicatePeople}</b> candidate{usage.duplicatePeople === 1 ? "" : "s"} have{" "}
              <b>{usage.duplicateFolders}</b> extra folder{usage.duplicateFolders === 1 ? "" : "s"}{" "}
              (same email stored in several folders). Use “Organize Folders” to merge them into one.
            </p>
          )}
          {usage.unlinkedFolders > 0 && (
            <p>
              <b>{usage.unlinkedFolders}</b> folder{usage.unlinkedFolders === 1 ? "" : "s"} (
              {formatSize(usage.unlinkedBytes)}) are not linked to any candidate in the database.
            </p>
          )}
        </div>
      )}

      <Panel
        kicker="Usage by organization"
        title="Who is taking the space"
        description={`${usage.organizations.length} organizations • ${usage.candidateFolders} candidate files • ${formatSize(usage.tenantBytes)} in candidate folders`}
      >
        {usage.organizations.length === 0 ? (
          <EmptyState icon={Users} title="No stored files" description="Nothing is stored yet." />
        ) : (
          <ul className="divide-y divide-border/50 rounded-lg border border-border/60 overflow-hidden dark:divide-white/[0.05] dark:border-white/[0.06]">
            {usage.organizations.map((org) => {
              const expanded = open.has(org.id);
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    onClick={() => toggle(org.id)}
                    className="flex w-full items-center gap-3 p-3 text-left text-xs hover:bg-muted/30 dark:hover:bg-zinc-900/40"
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-semibold text-foreground text-sm">
                          {org.name}
                        </span>
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {formatSize(org.bytes)}
                        </span>
                      </div>
                      <Bar pct={(org.bytes / maxOrg) * 100} />
                      <p className="text-[11px] text-muted-foreground">
                        {org.candidates} candidate{org.candidates === 1 ? "" : "s"} • {org.files} files •
                        recordings {formatSize(org.recordingsBytes)} • images {formatSize(org.imagesBytes)} •
                        CV {formatSize(org.cvBytes)}
                      </p>
                    </div>
                  </button>
                  {expanded && (
                    <ul className="border-t border-border/40 bg-muted/20 dark:border-white/[0.04] dark:bg-zinc-900/30">
                      {org.projects.length === 0 ? (
                        <li className="px-10 py-2 text-[11px] text-muted-foreground">No project files</li>
                      ) : (
                        org.projects.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center justify-between gap-3 px-10 py-2 text-[11px]"
                          >
                            <span className="truncate text-foreground">{p.name}</span>
                            <span className="shrink-0 font-mono text-muted-foreground">
                              {p.candidates} cand. • {p.files} files •{" "}
                              <b className="text-foreground">{formatSize(p.bytes)}</b>
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel kicker="Largest candidates" title="Top 15 by size">
        {usage.topCandidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">No candidate files yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 text-[11px] uppercase tracking-wider text-muted-foreground dark:border-white/[0.06]">
                <tr>
                  <th className="px-3 py-2">Candidate</th>
                  <th className="px-3 py-2">Organization / Project</th>
                  <th className="px-3 py-2 text-right">Folders</th>
                  <th className="px-3 py-2 text-right">Files</th>
                  <th className="px-3 py-2 text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 dark:divide-white/[0.04]">
                {usage.topCandidates.map((c) => (
                  <tr key={c.groupKey}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-foreground">{c.name}</p>
                      {c.email && <p className="text-[11px] text-muted-foreground">{c.email}</p>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.organizationName ?? "—"} / {c.projectName ?? "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono",
                        c.folders > 1 && "font-semibold text-amber-500",
                      )}
                    >
                      {c.folders}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{c.files}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">
                      {formatSize(c.bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
