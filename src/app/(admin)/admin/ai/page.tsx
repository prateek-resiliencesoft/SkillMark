"use client";

import {
  DataTableWrapper,
  EmptyState,
  FilterBar,
  PageHeader,
  Panel,
  StatCard,
  TableHeadRow,
  TableRow,
  formatWhen,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { BUG_SEVERITIES, type BugSeverity } from "@/lib/bug-triage/types";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ExternalLink, MessageSquare, Settings2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

type Tab = "buckets" | "settings" | "chat";

const TRIGGER = "h-9 w-[150px] text-xs border-border/70 dark:border-white/[0.08] dark:bg-zinc-900/80";

const SEV_STYLE: Record<BugSeverity, string> = {
  critical: "bg-red-500/15 text-red-600 dark:text-red-400",
  error: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

export default function AdminAiTriagePage() {
  const [tab, setTab] = useState<Tab>("buckets");
  const [severity, setSeverity] = useState("all");
  const [hasIssue, setHasIssue] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim());
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const listInput = useMemo(
    () => ({
      severity: severity === "all" ? undefined : (severity as BugSeverity),
      hasIssue: hasIssue === "all" ? undefined : hasIssue === "yes",
      search: search || undefined,
    }),
    [severity, hasIssue, search],
  );

  const bucketsQ = trpc.bugTriage.bucketsList.useQuery(listInput, {
    staleTime: 10_000,
    keepPreviousData: true,
  });
  const settingsQ = trpc.bugTriage.settingsGet.useQuery(undefined, { staleTime: 30_000 });

  const settingsMut = trpc.bugTriage.settingsSet.useMutation({
    onSuccess: async () => {
      await utils.bugTriage.settingsGet.invalidate();
      toast({ title: "Settings saved" });
    },
    onError: (e) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const [enabled, setEnabled] = useState(true);
  const [errorThreshold, setErrorThreshold] = useState(10);
  const [noiseThreshold, setNoiseThreshold] = useState(50);
  const [windowDays, setWindowDays] = useState(7);

  useEffect(() => {
    if (!settingsQ.data) return;
    setEnabled(settingsQ.data.enabled);
    setErrorThreshold(settingsQ.data.errorThreshold);
    setNoiseThreshold(settingsQ.data.noiseThreshold);
    setWindowDays(settingsQ.data.windowDays);
  }, [settingsQ.data]);

  const buckets = bucketsQ.data?.buckets ?? [];
  const withIssues = buckets.filter((b) => b.githubIssueNumber != null).length;
  const hot = buckets.filter((b) => b.count7d > 0).length;

  const [chatInput, setChatInput] = useState("");
  const [chatMsgs, setChatMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const chatMut = trpc.bugTriage.chat.useMutation({
    onSuccess: (res) => setChatMsgs((m) => [...m, { role: "assistant", content: res.reply }]),
    onError: (e) => toast({ title: "Chat failed", description: e.message, variant: "destructive" }),
  });

  function sendChat() {
    const text = chatInput.trim();
    if (!text || chatMut.isLoading) return;
    const next = [...chatMsgs, { role: "user" as const, content: text }];
    setChatMsgs(next);
    setChatInput("");
    chatMut.mutate({ messages: next });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Platform"
        title="AI Triage"
        description="Clusters feedback + error logs, ranks severity, and opens GitHub issues when rolling thresholds are hit."
      />

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["buckets", "Buckets", Sparkles],
            ["settings", "Settings", Settings2],
            ["chat", "Chat", MessageSquare],
          ] as const
        ).map(([id, label, Icon]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={tab === id ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => setTab(id)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {tab === "buckets" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard title="Open buckets" value={buckets.length} icon={Sparkles} loading={bucketsQ.isLoading} />
            <StatCard title="With GitHub issue" value={withIssues} icon={ExternalLink} loading={bucketsQ.isLoading} />
            <StatCard
              title={`Active (${bucketsQ.data?.settingsWindowDays ?? 7}d)`}
              value={hot}
              icon={MessageSquare}
              loading={bucketsQ.isLoading}
            />
          </div>

          {!bucketsQ.data?.available ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              Triage tables not applied yet. Run <code>db/init/44-bug-triage.sql</code> (or <code>npm run db:migrate</code>).
            </div>
          ) : null}

          <FilterBar>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className={TRIGGER}>
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {BUG_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={hasIssue} onValueChange={setHasIssue}>
              <SelectTrigger className={TRIGGER}>
                <SelectValue placeholder="GitHub" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any GitHub state</SelectItem>
                <SelectItem value="yes">Has issue</SelectItem>
                <SelectItem value="no">No issue</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title / key…"
              className="h-9 max-w-xs text-xs"
            />
          </FilterBar>

          <DataTableWrapper>
            <table className="w-full text-sm">
              <thead>
                <TableHeadRow>
                  <th className="px-3 py-2 text-left font-medium">Bug</th>
                  <th className="px-3 py-2 text-left font-medium">Severity</th>
                  <th className="px-3 py-2 text-right font-medium">Count</th>
                  <th className="px-3 py-2 text-left font-medium">GitHub</th>
                  <th className="px-3 py-2 text-left font-medium">Updated</th>
                </TableHeadRow>
              </thead>
              <tbody>
                {bucketsQ.isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : buckets.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="No buckets yet" description="New feedback and error logs enqueue here for AI clustering." />
                    </td>
                  </tr>
                ) : (
                  buckets.map((b) => (
                    <TableRow key={b.id}>
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium">{b.title}</div>
                        <div className="text-xs text-muted-foreground font-mono">{b.bugKey}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{b.summary}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <Badge className={cn("border-0 capitalize", SEV_STYLE[b.severity])}>{b.severity}</Badge>
                      </td>
                      <td className="px-3 py-2.5 align-top text-right tabular-nums">{b.count7d}</td>
                      <td className="px-3 py-2.5 align-top">
                        {b.githubIssueUrl ? (
                          <Link
                            href={b.githubIssueUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            #{b.githubIssueNumber}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs text-muted-foreground">{formatWhen(b.updatedAt)}</td>
                    </TableRow>
                  ))
                )}
              </tbody>
            </table>
          </DataTableWrapper>
        </>
      ) : null}

      {tab === "settings" ? (
        <Panel className="max-w-xl space-y-5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Triage enabled</div>
              <div className="text-xs text-muted-foreground">Kill switch — when off, cron leaves the queue alone.</div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Error / critical threshold</span>
            <Input
              type="number"
              min={1}
              value={errorThreshold}
              onChange={(e) => setErrorThreshold(Number(e.target.value) || 1)}
              className="h-9"
            />
            <span className="text-xs text-muted-foreground">Open GitHub issue at this many hits in the window.</span>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Info / warning threshold</span>
            <Input
              type="number"
              min={1}
              value={noiseThreshold}
              onChange={(e) => setNoiseThreshold(Number(e.target.value) || 1)}
              className="h-9"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Window (days)</span>
            <Input
              type="number"
              min={1}
              max={90}
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value) || 7)}
              className="h-9"
            />
          </label>
          <Button
            type="button"
            disabled={settingsMut.isLoading}
            onClick={() =>
              settingsMut.mutate({ enabled, errorThreshold, noiseThreshold, windowDays })
            }
          >
            Save settings
          </Button>
        </Panel>
      ) : null}

      {tab === "chat" ? (
        <Panel className="flex max-w-3xl flex-col gap-3 p-4">
          <div className="min-h-[280px] max-h-[480px] space-y-3 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-3">
            {chatMsgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ask about hot buckets, thresholds, or what a GitHub issue covers. Context is current triage data.
              </p>
            ) : (
              chatMsgs.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                    m.role === "user" ? "ml-8 bg-primary/10" : "mr-8 bg-card border border-border/50",
                  )}
                >
                  {m.content}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="e.g. Which error/critical bugs are closest to the threshold?"
              className="min-h-[60px] text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
            <Button type="button" className="shrink-0 self-end" disabled={chatMut.isLoading} onClick={sendChat}>
              Send
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
