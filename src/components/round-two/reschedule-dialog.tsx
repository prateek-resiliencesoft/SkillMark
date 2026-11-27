"use client";

import { CopyField } from "@/components/round-two/create-round-two-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { defaultRescheduleInput, formatIst, canReschedule, isoToIstInput, istInputToIso, rescheduleMode } from "@/lib/round-two/reschedule";
import { trpc } from "@/lib/trpc/client";
import { CalendarClock, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Person = { email: string; role: "interviewer" | "observer" };
type Done = {
  roundTwoId: string;
  mode: "new_attempt" | "in_place";
  candidateLink: string;
  candidateDelivery: { status: string; error?: string };
  invites: { email: string; link: string; delivery: { status: string; error?: string } }[];
};

/** "Reschedule Round 2" for a round that is over (new attempt) or not started yet (new time). Managers only. */
export function RescheduleRoundTwoButton({
  roundId,
  status,
  canManage,
  size = "sm",
  variant = "outline",
  onDone,
}: {
  roundId: string;
  status: string;
  canManage: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "default";
  onDone?: (roundTwoId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!canManage || !canReschedule(status) || status === "draft") return null;
  const inPlace = rescheduleMode(status) === "in_place";
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> {inPlace ? "Change time" : "Reschedule Round 2"}
      </Button>
      <RescheduleRoundTwoDialog roundId={roundId} status={status} open={open} onOpenChange={setOpen} onDone={onDone} />
    </>
  );
}

export function RescheduleRoundTwoDialog({
  roundId,
  status,
  open,
  onOpenChange,
  onDone,
}: {
  roundId: string;
  status: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (roundTwoId: string) => void;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const inPlace = rescheduleMode(status) === "in_place";
  const q = trpc.roundTwo.get.useQuery({ id: roundId }, { enabled: open, retry: false });
  const [when, setWhen] = useState(() => defaultRescheduleInput());
  const [durationMin, setDurationMin] = useState(45);
  const [people, setPeople] = useState<Person[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Person["role"]>("interviewer");
  const [note, setNote] = useState("");
  const [emailCandidate, setEmailCandidate] = useState(true);
  const [done, setDone] = useState<Done | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Start from the previous round: same duration and panel (editable here).
  useEffect(() => {
    if (!open || !q.data || loadedFor === roundId) return;
    setLoadedFor(roundId);
    setDurationMin(q.data.round.durationMin);
    setPeople(
      q.data.participants
        .filter((p) => p.role !== "host" && p.status !== "revoked")
        .map((p) => ({ email: (p.email as string).toLowerCase(), role: p.role === "observer" ? "observer" : "interviewer" })),
    );
    if (inPlace && q.data.round.scheduledAt) {
      const cur = isoToIstInput(q.data.round.scheduledAt);
      if (cur && Date.parse(q.data.round.scheduledAt) > Date.now()) setWhen(cur);
    }
  }, [open, q.data, loadedFor, roundId, inPlace]);

  const reschedule = trpc.roundTwo.reschedule.useMutation({
    onSuccess: (r) => {
      setDone(r as Done);
      void utils.roundTwo.invalidate();
      onDone?.(r.roundTwoId);
    },
    onError: (err) => toast({ title: "Couldn't reschedule", description: err.message, variant: "destructive" }),
  });

  const iso = istInputToIso(when);
  const past = !!iso && Date.parse(iso) < Date.now();
  const addPerson = () => {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e) || people.some((p) => p.email === e)) return;
    setPeople([...people, { email: e, role }]);
    setEmail("");
  };
  const submit = () => {
    if (!iso || past) return;
    reschedule.mutate({ id: roundId, scheduledAt: iso, durationMin, interviewers: people, note: note.trim() || undefined, emailCandidate });
  };
  const close = (v: boolean) => {
    if (!v) setDone(null);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{inPlace ? "Change the Round 2 time" : "Reschedule Round 2"}</DialogTitle>
          <DialogDescription>
            {inPlace
              ? "Sets a new time and a new candidate link for this interview."
              : "Creates a new attempt with the same plan, a new room and a new candidate link. The earlier attempt, its report, recording and transcript stay as history."}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm">
              {done.mode === "new_attempt" ? "New Round 2 attempt created." : "Round 2 time updated."}{" "}
              {done.candidateDelivery.status === "sent" ? "The candidate was emailed." : "The candidate was not emailed; share the link below."}
            </p>
            <CopyField label="New candidate link (shown once)" value={done.candidateLink} />
            {done.invites.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">Panel invite links</Label>
                {done.invites.map((i) => (
                  <div key={i.email} className="space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {i.email} · {i.delivery.status === "sent" ? "emailed" : "not emailed, share manually"}
                    </div>
                    <CopyField value={i.link} />
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              {done.roundTwoId !== roundId && (
                <Button asChild>
                  <Link href={`/round-two/${done.roundTwoId}`}>Open new attempt</Link>
                </Button>
              )}
              <Button variant="outline" onClick={() => close(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
              <div className="space-y-1">
                <Label className="text-xs">Date and time (IST, India Standard Time)</Label>
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                {iso && <p className={past ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{past ? "That time has passed. " : ""}{formatIst(iso)}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Minutes</Label>
                <Input
                  type="number"
                  min={10}
                  max={240}
                  value={durationMin}
                  onChange={(e) => setDurationMin(Math.max(10, Math.min(240, Number(e.target.value) || 45)))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Panel (same as before; add or remove people)</Label>
              <div className="flex gap-2">
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPerson())}
                  placeholder="interviewer@company.com"
                />
                <select value={role} onChange={(e) => setRole(e.target.value as Person["role"])} className="h-10 rounded-md border bg-background px-2 text-sm">
                  <option value="interviewer">Interviewer</option>
                  <option value="observer">Observer</option>
                </select>
                <Button variant="outline" onClick={addPerson} aria-label="Add person">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {q.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading the previous panel…</p>
              ) : people.length === 0 ? (
                <p className="text-xs text-muted-foreground">Only you (the host) for now.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {people.map((p) => (
                    <span key={p.email} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
                      {p.email} · {p.role}
                      <button type="button" onClick={() => setPeople(people.filter((x) => x.email !== p.email))} aria-label={`Remove ${p.email}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">The question plan carries over from the previous round.</p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Note (optional, included in the emails)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Why it was rescheduled, anything to prepare" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={emailCandidate} onCheckedChange={(v) => setEmailCandidate(v === true)} />
              Email the candidate the new link
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!iso || past || reschedule.isLoading || q.isLoading}>
                {reschedule.isLoading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {inPlace ? "Save new time" : "Reschedule and send invites"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
