"use client";

import { BulkCvGenerator, FlagsPopover } from "@/components/batch/bulk-cv-generator";
import { SendInvitesDialog } from "@/components/batch/send-invites-dialog";
import {
  CompletionNotifyPicker,
  readyCompletionNotifyMembers,
} from "@/components/interview/completion-notify-picker";
import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompletionNotifyMember } from "@/lib/completion-notify";
import { parseCompletionNotifyMembers } from "@/lib/completion-notify";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { exportToXlsx } from "@/lib/export-xlsx";
import { needsFreshInviteLink } from "@/lib/session-link";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  CalendarDays,
  Check,
  Clock,
  Copy,
  Download,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Search,
  Send,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Status = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED" | "DISQUALIFIED";
const STATUS_META: Record<Status, { label: string; className: string }> = {
  NOT_STARTED: { label: "Not started", className: "bg-muted text-muted-foreground" },
  IN_PROGRESS: { label: "In progress", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300" },
  COMPLETED: { label: "Completed", className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" },
  ABANDONED: { label: "Left early", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  DISQUALIFIED: { label: "Disqualified", className: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300" },
};

type Filter = "all" | "pending" | Status;

function isInviteExpired(c: { expiresAt?: string | null; status: Status; completedAt?: string | null }): boolean {
  if (!c.expiresAt || c.status === "COMPLETED" || c.status === "DISQUALIFIED" || c.completedAt) return false;
  return new Date(c.expiresAt).getTime() < Date.now();
}

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const utils = trpc.useUtils();
  const batch = trpc.batch.getById.useQuery({ id }, { refetchInterval: 30_000 });

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendTo, setSendTo] = useState<string[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; email: string; phone: string } | null>(null);
  const [notifyMembers, setNotifyMembers] = useState<CompletionNotifyMember[]>([]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = batch.data?.settings as any;
    if (settings) {
      setNotifyMembers(parseCompletionNotifyMembers(settings.completionNotifyMembers));
    }
  }, [batch.data?.settings]);

  const updateSettings = trpc.batch.updateSettings.useMutation({
    onSuccess: () => {
      void utils.batch.getById.invalidate({ id });
      toast({ title: "Completion alerts saved" });
    },
    onError: (e) =>
      toast({ title: "Could not save alerts", description: e.message, variant: "destructive" }),
  });

  const updateContact = trpc.batch.updateContact.useMutation({
    onSuccess: () => {
      setEditing(null);
      void utils.batch.getById.invalidate({ id });
      toast({ title: "Contact updated" });
    },
    onError: (e) => toast({ title: "Could not update", description: e.message, variant: "destructive" }),
  });
  const deleteBatch = trpc.batch.delete.useMutation({
    onSuccess: () => router.push("/batches"),
    onError: (e) => toast({ title: "Could not delete", description: e.message, variant: "destructive" }),
  });
  const removeCandidate = trpc.batch.removeCandidate.useMutation({
    onSuccess: () => {
      void utils.batch.getById.invalidate({ id });
      toast({ title: "Candidate removed" });
    },
    onError: (e) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });
  const removeCandidates = trpc.batch.removeCandidates.useMutation({
    onSuccess: (r) => {
      setSelected(new Set());
      void utils.batch.getById.invalidate({ id });
      toast({
        title: `Removed ${r.removed} candidate${r.removed === 1 ? "" : "s"}`,
        description: r.blocked ? `${r.blocked} already started — left in batch` : undefined,
      });
    },
    onError: (e) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });

  const copyLink = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "Link copied" });
  };

  const sendNewLink = trpc.candidate.sendNewLink.useMutation({
    onSuccess: (d) => {
      void utils.batch.getById.invalidate({ id });
      const delivery = d.delivery as
        | { email?: { status: string; error?: string }; whatsapp?: { status: string; error?: string } }
        | undefined;
      const parts: string[] = [];
      let fail = false;
      for (const [ch, label] of [["whatsapp", "WhatsApp"], ["email", "Email"]] as const) {
        const r = delivery?.[ch];
        if (!r) continue;
        if (r.status !== "sent") fail = true;
        parts.push(`${label}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
      }
      const sent = parts.join(" · ");
      toast({
        title: fail ? "New link created, but some messages were not sent" : sent ? "New link sent" : "New link created",
        description: sent || "Copy the link to share it with the candidate.",
        variant: fail ? "destructive" : undefined,
        action: (
          <ToastAction altText="Copy link" onClick={() => void copyLink(d.inviteLink)}>
            Copy link
          </ToastAction>
        ),
      });
    },
    onError: (e) =>
      toast({ title: "Could not create a new link", description: e.message, variant: "destructive" }),
  });

  const candidates = useMemo(() => batch.data?.candidates ?? [], [batch.data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (filter === "pending" && (c.status === "COMPLETED" || c.status === "DISQUALIFIED")) return false;
      if (filter !== "all" && filter !== "pending" && c.status !== filter) return false;
      if (!q) return true;
      return [c.name, c.email, c.phone, ...(c.profile?.techStack ?? [])].some((v) => v?.toLowerCase().includes(q));
    });
  }, [candidates, filter, search]);

  if (batch.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!batch.data) {
    return <p className="text-muted-foreground">{batch.error?.message ?? "Batch not found"}</p>;
  }

  const b = batch.data;
  const invited = candidates.filter((c) => c.emailStatus === "sent" || c.whatsappStatus === "sent").length;
  const unsentIds = candidates
    .filter((c) => c.emailStatus !== "sent" && c.whatsappStatus !== "sent")
    .map((c) => c.id);
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const recipients = (sendTo ?? [])
    .map((cid) => candidates.find((c) => c.id === cid))
    .filter((c): c is (typeof candidates)[number] => !!c);

  const exportRows = () =>
    exportToXlsx(
      candidates.map((c) => ({
        Name: c.name,
        Email: c.email ?? "",
        Phone: c.phone ?? "",
        Status: STATUS_META[c.status].label,
        "Tech stack": c.profile?.techStack.join(", ") ?? "",
        "Experience (yrs)": c.profile?.totalExperienceYears ?? "",
        "Email invite": c.emailStatus ?? "",
        "WhatsApp invite": c.whatsappStatus ?? "",
        "Started at": c.startedAt ?? "",
        "Completed at": c.completedAt ?? "",
        "Interview link": c.inviteLink,
      })),
      b.name.replace(/[^\w-]+/g, "_"),
    );

  const stats: { label: string; value: number; filter: Filter }[] = [
    { label: "Candidates", value: b.counts.total, filter: "all" },
    { label: "Completed", value: b.counts.completed, filter: "COMPLETED" },
    { label: "In progress", value: b.counts.inProgress, filter: "IN_PROGRESS" },
    { label: "Not started", value: b.counts.notStarted, filter: "NOT_STARTED" },
    { label: "Left (pending)", value: b.counts.total - b.counts.completed - b.counts.disqualified, filter: "pending" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/batches" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Batches
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{b.name}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              Created {new Date(b.createdAt).toLocaleString()} · {invited} of {b.counts.total} invited
            </p>
            {b.settings.roleDescription && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{b.settings.roleDescription}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportRows}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            {b.canEdit && (
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add candidates
              </Button>
            )}
            {b.canEdit && unsentIds.length > 0 && (
              <Button variant="outline" onClick={() => setSendTo(unsentIds)}>
                <Send className="mr-2 h-4 w-4" />
                Send to unsent ({unsentIds.length})
              </Button>
            )}
            {b.canEdit && (
              <Button onClick={() => setSendTo(selected.size ? Array.from(selected) : candidates.map((c) => c.id))} disabled={!candidates.length}>
                <Send className="mr-2 h-4 w-4" />
                {selected.size ? `Send to ${selected.size} selected` : "Send to all"}
              </Button>
            )}
            {b.canEdit && selected.size > 0 && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={removeCandidates.isLoading}
                onClick={() => {
                  const removable = candidates.filter(
                    (c) => selected.has(c.id) && c.status === "NOT_STARTED",
                  );
                  if (!removable.length) {
                    toast({
                      title: "Nothing to remove",
                      description: "Only candidates who have not started can be removed",
                      variant: "destructive",
                    });
                    return;
                  }
                  if (
                    !confirm(
                      `Remove ${removable.length} not-started candidate${removable.length === 1 ? "" : "s"} from this batch? Their interviews will be deleted.`,
                    )
                  ) {
                    return;
                  }
                  removeCandidates.mutate({
                    batchId: id,
                    candidateIds: removable.map((c) => c.id),
                  });
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove selected
              </Button>
            )}
            {b.canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/interviews/new?tab=bulk">New batch</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      if (confirm(`Delete "${b.name}" and all ${b.counts.total} interviews, sessions and results in it? This cannot be undone.`)) {
                        deleteBatch.mutate({ id });
                      }
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete batch
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => {
          const isSelected = filter === s.filter;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setFilter(s.filter)}
              className={cn(
                "group relative rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 outline-none",
                isSelected ? "border-primary/40 ring-1 ring-primary/20" : "",
              )}
            >
              {isSelected && (
                <motion.div
                  layoutId="batch-stat-filter-active"
                  className="pointer-events-none absolute inset-0 rounded-xl border-2 border-primary bg-primary/5 shadow-xs"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <p className="relative z-10 text-2xl font-semibold tabular-nums">{s.value}</p>
              <p className="relative z-10 text-xs text-muted-foreground">{s.label}</p>
            </button>
          );
        })}
      </div>

      {b.canEdit && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Completion alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CompletionNotifyPicker
              organizationId={currentOrg?.id ?? ""}
              value={notifyMembers}
              onChange={setNotifyMembers}
            />
            <Button
              size="sm"
              disabled={updateSettings.isLoading}
              onClick={() =>
                updateSettings.mutate({
                  batchId: id,
                  completionNotifyMembers: readyCompletionNotifyMembers(notifyMembers),
                })
              }
            >
              Save alert recipients
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search name, email, skill…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const c of visible) {
                            if (v) next.add(c.id);
                            else next.delete(c.id);
                          }
                          return next;
                        })
                      }
                    />
                  </TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Interview</TableHead>
                  <TableHead>Invites</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={(v) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{c.name}</p>
                        {!!c.profile?.reviewFlags?.length && <FlagsPopover flags={c.profile.reviewFlags} />}
                      </div>
                      <p className="text-xs text-muted-foreground">{c.email ?? "no email"}</p>
                      <p className="text-xs text-muted-foreground">{c.phone ?? "no phone"}</p>
                      {c.scheduledAt && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary">
                          <Calendar className="h-3 w-3" />
                          {new Date(c.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                      {c.expiresAt && !c.completedAt && (
                        <p className={cn("flex items-center gap-1 text-[11px]", isInviteExpired(c) ? "font-medium text-destructive" : "text-muted-foreground")}>
                          <Clock className="h-3 w-3" />
                          {isInviteExpired(c) ? "Expired" : "Expires"}{" "}
                          {new Date(c.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      {c.profile?.headline && <p className="text-sm">{c.profile.headline}</p>}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(c.profile?.techStack ?? []).slice(0, 6).map((t) => (
                          <Badge key={t} variant="secondary" className="font-normal">
                            {t}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[
                          c.profile?.totalExperienceYears != null ? `${c.profile.totalExperienceYears} yrs` : null,
                          c.profile?.projects.length ? `${c.profile.projects.length} projects` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_META[c.status].className)}>
                          {STATUS_META[c.status].label}
                        </span>
                        {isInviteExpired(c) && (
                          <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/40 dark:text-red-300">
                            Expired
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.questionCount} questions
                        {c.completedAt && ` · ${new Date(c.completedAt).toLocaleDateString()}`}
                        {c.durationSeconds ? ` · ${Math.round(c.durationSeconds / 60)} min` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <InviteState icon={Mail} status={c.emailStatus} at={c.emailSentAt} />
                      <InviteState icon={MessageCircle} status={c.whatsappStatus} at={c.whatsappSentAt} />
                      {c.lastSendError && (
                        <p className="mt-1 max-w-[220px] text-xs text-destructive" title={c.lastSendError}>
                          {c.lastSendError.slice(0, 90)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {b.canEdit && needsFreshInviteLink({ session: c.session, expiresAt: c.expiresAt }) ? (
                            <DropdownMenuItem
                              disabled={sendNewLink.isLoading}
                              onClick={() => {
                                if (
                                  !confirm(
                                    "Send a new link? The old link will stop working and the old attempt stays in records.",
                                  )
                                ) {
                                  return;
                                }
                                sendNewLink.mutate({ candidateId: c.id });
                              }}
                            >
                              <Send className="mr-2 h-4 w-4" />
                              Send new link
                            </DropdownMenuItem>
                          ) : b.canEdit ? (
                            <DropdownMenuItem onClick={() => setSendTo([c.id])}>
                              <Send className="mr-2 h-4 w-4" />
                              Send link
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onClick={() => void copyLink(c.inviteLink)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy link
                          </DropdownMenuItem>
                          {c.sessionId && (
                            <DropdownMenuItem asChild>
                              <Link href={`/interviews/${c.interviewId}/results?session=${c.sessionId}`}>
                                <BarChart3 className="mr-2 h-4 w-4" />
                                View results
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {b.canEdit && (
                            <>
                              <DropdownMenuItem asChild>
                                <Link href={`/interviews/${c.interviewId}/edit`}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Review / refine questions
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setEditing({ id: c.id, name: c.name, email: c.email ?? "", phone: c.phone ?? "" })}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit contact
                              </DropdownMenuItem>
                              {c.status === "NOT_STARTED" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    disabled={removeCandidate.isLoading}
                                    onClick={() => {
                                      if (
                                        !confirm(
                                          `Remove ${c.name} from this batch? Their interview will be deleted. This cannot be undone.`,
                                        )
                                      ) {
                                        return;
                                      }
                                      removeCandidate.mutate({ batchId: id, candidateId: c.id });
                                      setSelected((prev) => {
                                        const next = new Set(prev);
                                        next.delete(c.id);
                                        return next;
                                      });
                                    }}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Remove from batch
                                  </DropdownMenuItem>
                                </>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {!visible.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      No candidates match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <SendInvitesDialog
        open={!!sendTo}
        onOpenChange={(o) => !o && setSendTo(null)}
        batchId={id}
        organizationId={currentOrg?.id}
        recipients={recipients.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          scheduledAt: c.scheduledAt,
          expiresAt: c.expiresAt,
          emailStatus: c.emailStatus,
          whatsappStatus: c.whatsappStatus,
        }))}
        onSent={() => {
          setSelected(new Set());
          void utils.batch.getById.invalidate({ id });
        }}
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add candidates to {b.name}</DialogTitle>
            <DialogDescription>
              Upload more CVs. New interviews reuse this batch&apos;s role settings. Send invite links after they are generated.
            </DialogDescription>
          </DialogHeader>
          <BulkCvGenerator
            existingBatchId={id}
            existingBatchName={b.name}
            compact
            onFinished={() => {
              setAddOpen(false);
              void utils.batch.getById.invalidate({ id });
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp phone (with country code)</Label>
                <Input
                  placeholder="+919876543210"
                  value={editing.phone}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value.replace(/[^\d+]/g, "") })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!editing?.name.trim() || updateContact.isLoading}
              onClick={() =>
                editing &&
                updateContact.mutate({
                  candidateId: editing.id,
                  name: editing.name.trim(),
                  email: editing.email.trim() || null,
                  phone: editing.phone.trim() || null,
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InviteState({ icon: Icon, status, at }: { icon: React.ElementType; status: string | null; at: string | null }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" title={at ? new Date(at).toLocaleString() : undefined}>
      <Icon className="h-3.5 w-3.5" />
      {status === "sent" ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : status === "failed" ? (
        <X className="h-3.5 w-3.5 text-destructive" />
      ) : null}
      {status === "sent" ? "Sent" : status === "failed" ? "Failed" : status === "skipped" ? "Skipped" : "Not sent"}
    </p>
  );
}
