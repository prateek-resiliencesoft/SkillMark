"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { CalendarClock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESETS = [
  { id: "1", label: "+1 day", days: 1 },
  { id: "3", label: "+3 days", days: 3 },
  { id: "7", label: "+7 days", days: 7 },
] as const;

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Red "Expired" pill used wherever a candidate's invite link is past its deadline. */
export function ExpiredBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/40 dark:text-red-300",
        className,
      )}
    >
      Expired
    </span>
  );
}

/**
 * Panel for reviving an expired invite link by moving its deadline forward. The token is
 * unchanged, so after extending, the normal send options (resend, left-interview follow-up)
 * apply again. `onExtendAndSend` adds a second button that extends and then lets the caller
 * continue straight into sending.
 */
export function ExtendExpiryDialog({
  open,
  onOpenChange,
  candidateId,
  candidateName,
  expiresAt,
  onExtended,
  onExtendAndSend,
  sendLabel = "Extend & send link",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  candidateName?: string | null;
  expiresAt?: string | null;
  onExtended?: (expiresAt: string) => void;
  /** When set, shows "Extend & send link"; called after the expiry was saved. */
  onExtendAndSend?: (expiresAt: string) => void;
  sendLabel?: string;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [preset, setPreset] = useState<string>("7");
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!open) return;
    setPreset("7");
    setCustom(toLocalInput(new Date(Date.now() + 7 * DAY_MS)));
  }, [open]);

  const next: Date | null = (() => {
    if (preset === "custom") {
      const d = new Date(custom);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const p = PRESETS.find((x) => x.id === preset);
    return p ? new Date(Date.now() + p.days * DAY_MS) : null;
  })();
  const inFuture = !!next && next.getTime() > Date.now();

  const extend = trpc.candidate.extendExpiry.useMutation({
    onError: (e) => toast({ title: "Could not extend expiry", description: e.message, variant: "destructive" }),
  });

  const run = (andSend: boolean) => {
    if (!next || !inFuture) return;
    extend.mutate(
      { candidateId, expiresAt: next.toISOString() },
      {
        onSuccess: (r) => {
          void utils.candidate.getById.invalidate({ id: candidateId });
          void utils.candidate.listAll.invalidate();
          void utils.batch.getById.invalidate();
          toast({
            title: "Expiry extended",
            description: `Link is valid until ${fmt(r.expiresAt)}.`,
          });
          onOpenChange(false);
          onExtended?.(r.expiresAt);
          if (andSend) onExtendAndSend?.(r.expiresAt);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Extend link expiry
          </DialogTitle>
          <DialogDescription>
            {candidateName ? `${candidateName}'s` : "This"} invite link
            {expiresAt ? ` expired on ${fmt(expiresAt)}` : " has expired"}. Pick a new deadline to make it work again,
            then send it to them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {[...PRESETS, { id: "custom", label: "Custom" }].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-sm transition-colors",
                  preset === p.id
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "hover:border-primary/40 hover:bg-muted/50",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="extend-expiry-custom">New expiry</Label>
              <Input
                id="extend-expiry-custom"
                type="datetime-local"
                value={custom}
                min={toLocalInput(new Date())}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
          )}

          <p className={cn("text-sm", next && !inFuture ? "text-destructive" : "text-muted-foreground")}>
            {next
              ? inFuture
                ? `New expiry: ${fmt(next.toISOString())}`
                : "Pick a time in the future."
              : "Pick a valid date and time."}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={extend.isLoading}>
            Cancel
          </Button>
          <Button variant={onExtendAndSend ? "outline" : "default"} disabled={!inFuture || extend.isLoading} onClick={() => run(false)}>
            {extend.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Extend
          </Button>
          {onExtendAndSend && (
            <Button disabled={!inFuture || extend.isLoading} onClick={() => run(true)}>
              {sendLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
