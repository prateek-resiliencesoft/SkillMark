"use client";

import { CopyField } from "@/components/round-two/create-round-two-sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { ChevronDown, ChevronUp, Link2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Host-only: candidate join URL + reusable partner invite URL.
 * Fixed-height collapsible so it never resizes the video stage.
 */
export function RoomShareLinks({ roundTwoId }: { roundTwoId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<{ candidateLink: string; partnerLink: string } | null>(null);
  const ensure = trpc.roundTwo.ensureShareLinks.useMutation({
    onSuccess: (r) => setLinks(r),
    onError: (err) => toast({ title: "Couldn't load invite links", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!links && !ensure.isLoading && !ensure.isError) ensure.mutate({ id: roundTwoId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundTwoId]);

  return (
    <div className="shrink-0 rounded-lg border bg-card/80">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
        Invite links
        <span className="text-muted-foreground font-normal">· candidate + partner</span>
        <span className="ml-auto text-muted-foreground">{open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          {ensure.isLoading && !links ? (
            <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing links…
            </div>
          ) : links ? (
            <>
              <CopyField label="Candidate link (send to interviewee)" value={links.candidateLink} />
              <CopyField label="Partner invite link (panelists)" value={links.partnerLink} />
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-8" onClick={() => ensure.mutate({ id: roundTwoId })} disabled={ensure.isLoading}>
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
