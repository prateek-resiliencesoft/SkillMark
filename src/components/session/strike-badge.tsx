"use client";

import { subscribeStrikes, type StrikeState } from "@/lib/integrity/bus";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Candidate-facing strike counter. Hidden until the first strike. Live updates
 * come from the guards (bus); the query restores the count after a page reload.
 */
export function StrikeBadge({ sessionId, enabled }: { sessionId?: string; enabled: boolean }) {
  const q = trpc.session.getStrikes.useQuery(
    { sessionId: sessionId ?? "" },
    { enabled: enabled && !!sessionId, refetchOnWindowFocus: false },
  );
  const [live, setLive] = useState<StrikeState | null>(null);
  useEffect(() => subscribeStrikes(setLive), []);

  const count = live?.count ?? q.data?.count ?? 0;
  const max = live?.max ?? q.data?.max ?? 4;
  if (!enabled || count === 0 || live?.disqualified) return null;

  // One more strike ends the interview.
  const nextDisqualifies = count >= max - 1;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed right-3 top-3 z-[9990] flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-md",
        nextDisqualifies
          ? "border-red-300 bg-red-600 text-white"
          : "border-amber-300 bg-amber-100 text-amber-900",
      )}
    >
      <ShieldAlert className="h-3.5 w-3.5" />
      Strikes {count} of {max}
      {nextDisqualifies && <span className="font-normal">· next strike disqualifies</span>}
    </div>
  );
}
