"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Camera, Mic } from "lucide-react";
import { useState } from "react";

/** Round 2 recording player + camera snapshots (same evidence round 1 keeps). */
export function RoundTwoMedia({ id, enabled = true, compact = false }: { id: string; enabled?: boolean; compact?: boolean }) {
  const q = trpc.roundTwo.media.useQuery(
    { id },
    {
      enabled: !!id && enabled,
      retry: false,
      // Joined + transcribed by the report run; refresh until it lands.
      refetchInterval: (d) => (d?.recordingPending ? 15_000 : false),
    },
  );
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton className="h-16 w-full" />;
  const data = q.data;
  return (
    <div className={cn("space-y-3", compact ? "text-xs" : "text-sm")}>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 font-medium">
          <Mic className="h-3.5 w-3.5 text-primary" /> Recording
        </p>
        {data?.recording ? (
          <audio controls preload="none" src={data.recording.url} className="w-full" />
        ) : data?.recordingPending ? (
          <p className="text-xs text-muted-foreground">The recording is being prepared with the report. It will appear here in a few minutes.</p>
        ) : (
          <p className="text-xs text-muted-foreground">No recording was saved for this round.</p>
        )}
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 font-medium">
          <Camera className="h-3.5 w-3.5 text-primary" /> Camera snapshots{data?.snapshots.length ? ` (${data.snapshots.length})` : ""}
        </p>
        {data?.snapshots.length ? (
          <div className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6")}>
            {data.snapshots.map((s) => (
              <button key={s.url} type="button" className="group overflow-hidden rounded-md border text-left" onClick={() => setOpen(open === s.url ? null : s.url)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                <img src={s.url} alt={`Snapshot at ${new Date(s.at).toLocaleTimeString()}`} loading="lazy" className="aspect-video w-full object-cover" />
                <span className="block px-1.5 py-0.5 text-[10px] text-muted-foreground">{new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No snapshots were taken (camera off or not shared).</p>
        )}
        {open && (
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
          <img src={open} alt="Snapshot" className="mt-2 w-full rounded-md border" onClick={() => setOpen(null)} />
        )}
      </div>
    </div>
  );
}
