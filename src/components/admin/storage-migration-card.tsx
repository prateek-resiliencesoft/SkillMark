"use client";

import { useRef } from "react";
import { AlertTriangle, CheckCircle2, CloudDownload, Play, ShieldCheck } from "lucide-react";
import { Panel, TacticalButton } from "@/components/admin/admin-ui";
import { formatSize } from "@/components/admin/storage-usage-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<string, string> = {
  idle: "Not started",
  running: "Copying…",
  paused: "Paused",
  blocked: "Blocked",
  done: "Copy finished",
  failed: "Finished with errors",
};

/** Super-admin card: copy every file from the old bucket to this server, then verify. */
export function StorageMigrationCard({ onFinished }: { onFinished?: () => void }) {
  const { toast } = useToast();
  const wasRunning = useRef(false);
  const statusQuery = trpc.platform.storageMigrationStatus.useQuery(undefined, {
    refetchInterval: (data) => (data?.status.state === "running" ? 3000 : false),
    onSuccess: (data) => {
      if (data.status.state !== "running" && wasRunning.current) onFinished?.();
      wasRunning.current = data.status.state === "running";
    },
  });
  const preflight = trpc.platform.storageMigrationPreflight.useQuery(undefined, {
    enabled: false,
    retry: false,
  });
  const start = trpc.platform.startStorageMigration.useMutation({
    onSuccess: (r) => {
      toast({ title: r.started ? "Copy started" : "A copy is already running" });
      statusQuery.refetch();
    },
    onError: (err) => toast({ title: "Could not start the copy", description: err.message, variant: "destructive" }),
  });
  const verify = trpc.platform.verifyStorageMigration.useMutation({
    onSuccess: (v) => {
      toast({
        title: v.missingCount || v.sizeMismatchCount ? "Some files are not on the server yet" : "All files are on the server",
        description: `${v.ok} of ${v.totalObjects} files match.`,
        variant: v.missingCount || v.sizeMismatchCount ? "destructive" : undefined,
      });
      statusQuery.refetch();
    },
    onError: (err) => toast({ title: "Could not verify", description: err.message, variant: "destructive" }),
  });
  const fixRefs = trpc.platform.fixStorageReferences.useMutation({
    onSuccess: (r) =>
      toast({
        title: r.dryRun
          ? `${r.valuesToFix} old file link${r.valuesToFix === 1 ? "" : "s"} found`
          : `${r.valuesToFix} old file link${r.valuesToFix === 1 ? "" : "s"} fixed`,
        description: r.errors.length ? r.errors.slice(0, 3).join(" • ") : undefined,
        variant: r.errors.length ? "destructive" : undefined,
      }),
    onError: (err) => toast({ title: "Could not check file links", description: err.message, variant: "destructive" }),
  });
  const refReport = fixRefs.data;

  if (statusQuery.isLoading) return <Skeleton className="h-36 w-full rounded-xl" />;
  const data = statusQuery.data;
  if (!data || !data.bucketConfigured) return null;

  const s = data.status;
  const done = s.copied + s.skipped;
  const pct = s.totalObjects ? Math.min(100, (done / s.totalObjects) * 100) : 0;
  const running = s.state === "running";
  const v = data.lastVerify;
  const verifiedClean = !!v && v.missingCount === 0 && v.sizeMismatchCount === 0 && v.totalObjects > 0;
  const p = preflight.data;
  const startLabel = s.state === "idle" ? "Start copy" : "Resume copy";

  return (
    <Panel
      kicker="Storage migration"
      title="Move media from Backblaze to this server"
      description={
        <>
          Copies every recording, image and CV from bucket <b>{data.bucketName ?? "—"}</b> to this server&apos;s
          disk with the same names, so links keep working. Nothing is deleted from Backblaze. Safe to stop and
          resume.
        </>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <TacticalButton
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => preflight.refetch()}
            disabled={preflight.isFetching || running}
          >
            <CloudDownload className={cn("h-3.5 w-3.5", preflight.isFetching && "animate-pulse")} />
            {preflight.isFetching ? "Checking…" : "Check bucket"}
          </TacticalButton>
          <TacticalButton
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => start.mutate()}
            disabled={running || start.isPending || (p ? !p.enoughSpace : false)}
          >
            <Play className="h-3.5 w-3.5" />
            {running ? "Copying…" : startLabel}
          </TacticalButton>
          <TacticalButton
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => verify.mutate()}
            disabled={running || verify.isPending}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {verify.isPending ? "Verifying…" : "Verify"}
          </TacticalButton>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        {!data.writesToServer && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-300">
            New uploads still go to Backblaze. Set <code>STORAGE_DRIVER=local</code> (keep the B2 keys) and
            restart the app so new files are saved on this server, then run the copy.
          </p>
        )}

        {preflight.error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-destructive">
            {preflight.error.message}
          </p>
        )}
        {p && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Files in bucket" value={`${p.totalObjects}`} sub={formatSize(p.totalBytes)} />
            <Fact label="Already on server" value={`${p.alreadyLocal}`} />
            <Fact label="Left to copy" value={`${p.toCopyObjects}`} sub={formatSize(p.toCopyBytes)} />
            <Fact
              label="Free disk"
              value={formatSize(p.diskFreeBytes)}
              sub={p.enoughSpace ? "Enough space" : "Not enough (needs +10%)"}
              bad={!p.enoughSpace}
            />
          </div>
        )}

        {s.state !== "idle" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-foreground">{STATE_LABEL[s.state] ?? s.state}</span>
              <span className="font-mono text-muted-foreground">
                {done} / {s.totalObjects} files • {pct.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60 dark:bg-white/[0.06]">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  s.state === "done" ? "bg-emerald-500" : s.state === "running" ? "bg-primary" : "bg-amber-500",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-muted-foreground">
              Copied {s.copied} ({formatSize(s.bytesCopied)}) • already there {s.skipped} • failed {s.failedCount}
            </p>
            {s.message && s.state !== "running" && (
              <p
                className={cn(
                  "flex items-start gap-1.5",
                  s.state === "done" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300",
                )}
              >
                {s.state === "done" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                {s.message}
              </p>
            )}
            {s.failed.length > 0 && (
              <details className="rounded-md border border-border/60 p-2">
                <summary className="cursor-pointer text-muted-foreground">
                  {s.failedCount} file{s.failedCount === 1 ? "" : "s"} could not be copied
                </summary>
                <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto font-mono text-[11px]">
                  {s.failed.map((f) => (
                    <li key={f.key} className="break-all">
                      {f.key} — <span className="text-destructive">{f.error}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {v && (
          <div
            className={cn(
              "rounded-md border p-2.5",
              verifiedClean
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            {verifiedClean ? (
              <p className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> Verified: all {v.totalObjects} files are on this server.
              </p>
            ) : (
              <p className="font-medium">
                Last check: {v.ok} of {v.totalObjects} files on this server • {v.missingCount} missing •{" "}
                {v.sizeMismatchCount} different size
              </p>
            )}
            <p className="mt-0.5 opacity-80">Checked {new Date(v.checkedAt).toLocaleString()}</p>
            {verifiedClean && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-foreground">
                <span className="opacity-80">
                  Last step: some old records saved full Backblaze links instead of file paths.
                </span>
                <TacticalButton
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={fixRefs.isPending}
                  onClick={() => fixRefs.mutate({ dryRun: true })}
                >
                  {fixRefs.isPending && fixRefs.variables?.dryRun ? "Checking…" : "Check old links"}
                </TacticalButton>
                {refReport?.dryRun && refReport.valuesToFix > 0 && (
                  <TacticalButton
                    size="sm"
                    className="h-7 text-xs"
                    disabled={fixRefs.isPending}
                    onClick={() => fixRefs.mutate({ dryRun: false })}
                  >
                    Fix {refReport.valuesToFix} link{refReport.valuesToFix === 1 ? "" : "s"}
                  </TacticalButton>
                )}
                {refReport && (
                  <span className="opacity-80">
                    {refReport.dryRun
                      ? refReport.valuesToFix === 0
                        ? "No old links found."
                        : `${refReport.valuesToFix} in ${Object.entries(refReport.rowsToFix)
                            .filter(([, n]) => n > 0)
                            .map(([t, n]) => `${t} (${n})`)
                            .join(", ")}`
                      : `Fixed ${refReport.valuesToFix}.`}
                  </span>
                )}
              </div>
            )}
            {!verifiedClean && v.missing.length > 0 && (
              <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-auto font-mono text-[11px]">
                {v.missing.slice(0, 20).map((k) => (
                  <li key={k} className="break-all">
                    {k}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Fact({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-md border border-border/60 p-2 dark:border-white/[0.06]">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold text-foreground">{value}</p>
      {sub && <p className={cn("text-[11px]", bad ? "text-destructive" : "text-muted-foreground")}>{sub}</p>}
    </div>
  );
}
