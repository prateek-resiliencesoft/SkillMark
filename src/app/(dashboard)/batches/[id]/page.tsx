"use client";

import { FlagsPopover } from "@/components/batch/bulk-cv-generator";
import { SendInvitesDialog } from "@/components/batch/send-invites-dialog";
import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import { useToast } from "@/hooks/use-toast";
import { exportToXlsx } from "@/lib/export-xlsx";
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
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Status = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED" | "DISQUALIFIED";
const STATUS_META: Record<Status, { label: string; className: string }> = {
  NOT_STARTED: { label: "Not started", className: "bg-muted text-muted-foreground" },
  IN_PROGRESS: { label: "In progress", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300" },
  COMPLETED: { label: "Completed", className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" },
  ABANDONED: { label: "Left early", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  DISQUALIFIED: { label: "Disqualified", className: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300" },
};

type Filter = "all" | "pending" | Status;

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
  const [editing, setEditing] = useState<{ id: string; name: string; email: string; phone: string } | null>(null);

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
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const recipients = (sendTo ?? [])
    .map((cid) => candidates.find((c) => c.id === cid))
    .filter((c): c is (typeof candidates)[number] => !!c);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "Link copied" });
  };

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
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportRows}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            {b.canEdit && (
              <Button onClick={() => setSendTo(selected.size ? Array.from(selected) : candidates.map((c) => c.id))} disabled={!candidates.length}>
                <Send className="mr-2 h-4 w-4" />
                {selected.size ? `Send to ${selected.size} selected` : "Send to all"}
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
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Expires {new Date(c.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}
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
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_META[c.status].className)}>
                        {STATUS_META[c.status].label}
                      </span>
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
                          {b.canEdit && (
                            <DropdownMenuItem onClick={() => setSendTo([c.id])}>
                              <Send className="mr-2 h-4 w-4" />
                              Send link
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => void copy(c.inviteLink)}>
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
        recipients={recipients}
        onSent={() => {
          setSelected(new Set());
          void utils.batch.getById.invalidate({ id });
        }}
      />

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
