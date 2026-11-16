"use client";

import { CodeBlock, CopyButton } from "@/components/developers/api-reference";
import { mcpConfigs } from "@/components/developers/mcp-config";
import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { API_KEY_SCOPE_LABELS, type ApiKeyScope } from "@/lib/api-scopes";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { BookOpen, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const RESULT_SCOPES: ApiKeyScope[] = [
  "sessions:read",
  "results:read",
  "candidates:read",
  "interviews:read",
  "transcripts:read",
  "invites:write",
];
const OTHER_SCOPES: ApiKeyScope[] = ["interviews:write", "forms:read", "applications:read", "applications:write", "*"];
const DEFAULT_SCOPES: ApiKeyScope[] = ["sessions:read", "results:read", "candidates:read", "interviews:read"];

function when(v: string | null) {
  return v
    ? new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Never";
}

type Tab = "keys" | "mcp" | "usage";

export default function DevelopersPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";
  const isAdmin = currentOrg?.role === "OWNER" || currentOrg?.role === "ADMIN";
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("keys");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [env, setEnv] = useState<"live" | "test">("live");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(DEFAULT_SCOPES);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const keys = trpc.apiKey.orgList.useQuery({ organizationId: orgId }, { enabled: !!orgId && isAdmin });
  const usage = trpc.apiKey.orgUsage.useQuery(
    { organizationId: orgId, limit: 50 },
    { enabled: !!orgId && isAdmin && tab === "usage", refetchInterval: tab === "usage" ? 15_000 : false },
  );
  const onErr = (e: { message: string }) => toast({ title: "Could not do that", description: e.message, variant: "destructive" });
  const create = trpc.apiKey.orgCreate.useMutation({
    onSuccess: (d) => {
      setCreateOpen(false);
      setRevealed(d.key);
      setName("");
      setScopes(DEFAULT_SCOPES);
      void utils.apiKey.orgList.invalidate();
    },
    onError: onErr,
  });
  const rotate = trpc.apiKey.orgRotate.useMutation({
    onSuccess: (d) => {
      setRevealed(d.key);
      void utils.apiKey.orgList.invalidate();
    },
    onError: onErr,
  });
  const revoke = trpc.apiKey.orgRevoke.useMutation({
    onSuccess: () => {
      setRevokeId(null);
      toast({ title: "Key revoked" });
      void utils.apiKey.orgList.invalidate();
    },
    onError: onErr,
  });

  const keyName = (id: string | null) => keys.data?.find((k) => k.id === id)?.name ?? "—";
  const toggle = (s: ApiKeyScope) =>
    setScopes((cur) => {
      if (s === "*") return cur.includes("*") ? DEFAULT_SCOPES : ["*"];
      const next = cur.filter((x) => x !== "*");
      return next.includes(s) ? next.filter((x) => x !== s) : [...next, s];
    });

  const mcpUrl = `${origin}/api/mcp`;
  const configs = mcpConfigs(mcpUrl || "https://your-host.example/api/mcp");

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">API</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Let your website or backend read interview sessions and results, and invite candidates.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/developers/docs">
            <BookOpen className="mr-2 h-4 w-4" />
            API reference and try it
          </Link>
        </Button>
      </div>

      {!isAdmin ? (
        <Card className="border-border/60">
          <CardContent className="py-8 text-sm text-muted-foreground">
            Only organization owners and admins can manage API keys. You can still read the{" "}
            <Link href="/developers/docs" className="text-primary underline">API reference</Link>.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex gap-1 border-b">
            {(
              [
                ["keys", "API keys"],
                ["mcp", "Connect via MCP"],
                ["usage", "Requests"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
                  tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "keys" ? (
            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="font-heading text-base">API keys for {currentOrg?.name}</CardTitle>
                  <CardDescription>
                    A key only sees this organization&apos;s data. The full key is shown once; we keep only a hash.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setCreateOpen(true)}>Create key</Button>
              </CardHeader>
              <CardContent className="p-0">
                {keys.isLoading ? (
                  <div className="space-y-2 p-6">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : !keys.data?.length ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">No keys yet.</p>
                ) : (
                  <div className="overflow-x-auto border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">Name</th>
                          <th className="px-4 py-2 font-medium">Key</th>
                          <th className="px-4 py-2 font-medium">Scopes</th>
                          <th className="px-4 py-2 font-medium">Last used</th>
                          <th className="px-4 py-2 font-medium">Created</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {keys.data.map((k) => (
                          <tr key={k.id} className={cn(!k.active && "opacity-60")}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{k.name}</p>
                              <p className="text-xs text-muted-foreground">{k.createdBy ?? ""}</p>
                            </td>
                            <td className="px-4 py-2.5">
                              <code className="text-xs">{k.prefix ? `${k.prefix}…` : "—"}</code>
                              <div className="mt-0.5 flex gap-1">
                                <Badge variant="outline" className="text-[10px] font-normal">{k.environment}</Badge>
                                {!k.active ? <Badge variant="outline" className="text-[10px] font-normal text-destructive">{k.revokedAt ? "revoked" : "expired"}</Badge> : null}
                              </div>
                            </td>
                            <td className="max-w-[260px] px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {k.scopes.map((s) => (
                                  <code key={s} className="rounded bg-muted px-1 text-[10px]">{s === "*" ? "all" : s}</code>
                                ))}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{when(k.lastUsedAt)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{when(k.createdAt)}</td>
                            <td className="px-4 py-2.5 text-right">
                              {k.active ? (
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={rotate.isLoading} onClick={() => rotate.mutate({ organizationId: orgId, id: k.id })}>
                                    Rotate
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setRevokeId(k.id)}>
                                    Revoke
                                  </Button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {tab === "mcp" ? (
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="font-heading text-base">Connect via MCP</CardTitle>
                <CardDescription>
                  AI assistants such as Claude or Cursor can read your sessions and results through this server. It uses the same API keys and scopes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-1.5">
                  <Label>Server URL (Streamable HTTP)</Label>
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
                    <code className="flex-1 truncate text-xs">{mcpUrl}</code>
                    <CopyButton text={mcpUrl} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Header: <code>Authorization: Bearer rsi_live_…</code>. Tools: list_sessions, get_session, get_result, get_transcript, list_interviews, list_candidates (plus the older form and interview tools). A read-only key is safest for assistants.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Cursor (~/.cursor/mcp.json)</Label>
                  <CodeBlock code={configs.cursor} />
                </div>
                <div className="space-y-1.5">
                  <Label>Claude Desktop (claude_desktop_config.json)</Label>
                  <CodeBlock code={configs.claude} />
                  <p className="text-xs text-muted-foreground">Claude Desktop connects to remote servers through the small <code>mcp-remote</code> bridge (needs Node.js).</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Claude Code</Label>
                  <CodeBlock code={configs.claudeCode} />
                </div>
                <p className="text-xs text-muted-foreground">Replace <code>rsi_live_YOUR_KEY</code> with a key from the API keys tab.</p>
              </CardContent>
            </Card>
          ) : null}

          {tab === "usage" ? (
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="font-heading text-base">Recent requests</CardTitle>
                <CardDescription>
                  {usage.data ? `${usage.data.last24h} requests in the last 24 hours, ${usage.data.errors24h} with errors.` : "API and MCP requests made with this organization's keys."}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {usage.isLoading ? (
                  <div className="p-6"><Skeleton className="h-32 w-full" /></div>
                ) : !usage.data?.recent.length ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">No requests yet.</p>
                ) : (
                  <div className="overflow-x-auto border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">Time</th>
                          <th className="px-4 py-2 font-medium">Request</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                          <th className="px-4 py-2 font-medium">Time taken</th>
                          <th className="px-4 py-2 font-medium">Key</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y font-mono text-xs">
                        {usage.data.recent.map((r) => (
                          <tr key={r.id}>
                            <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{when(r.createdAt)}</td>
                            <td className="px-4 py-2">{r.method} {r.endpoint}</td>
                            <td className={cn("px-4 py-2", r.status >= 400 ? "text-red-600" : "text-emerald-700")}>{r.status}</td>
                            <td className="px-4 py-2 text-muted-foreground">{r.durationMs != null ? `${r.durationMs} ms` : "—"}</td>
                            <td className="px-4 py-2 font-sans">{keyName(r.apiKeyId)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Give it a name you will recognise, and only the access it needs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Company website" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="flex gap-2">
                {(["live", "test"] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEnv(e)}
                    className={cn("rounded-md border px-3 py-1.5 text-xs", env === e ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
                  >
                    {e === "live" ? "Live (rsi_live_…)" : "Test (rsi_test_…)"}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Both read the same data. Test keys mark form applications as test.</p>
            </div>
            <div className="space-y-2">
              <Label>Access</Label>
              <div className="grid gap-2">
                {RESULT_SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={scopes.includes("*") || scopes.includes(s)} disabled={scopes.includes("*")} onCheckedChange={() => toggle(s)} />
                    <span>{API_KEY_SCOPE_LABELS[s]}</span>
                    <code className="ml-auto text-[10px] text-muted-foreground">{s}</code>
                  </label>
                ))}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">More access</summary>
                <div className="mt-2 grid gap-2">
                  {OTHER_SCOPES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={scopes.includes(s)} disabled={s !== "*" && scopes.includes("*")} onCheckedChange={() => toggle(s)} />
                      <span>{API_KEY_SCOPE_LABELS[s]}</span>
                      <code className="ml-auto text-[10px] text-muted-foreground">{s}</code>
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim() || !scopes.length || create.isLoading}
              onClick={() => create.mutate({ organizationId: orgId, name: name.trim(), environment: env, scopes })}
            >
              {create.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealed} onOpenChange={(o) => !o && setRevealed(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription>This is the only time the full key is shown. Store it on your server, not in browser code.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
            <code className="flex-1 break-all text-xs">{revealed}</code>
            {revealed ? <CopyButton text={revealed} /> : null}
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke this key?</DialogTitle>
            <DialogDescription>Anything using &ldquo;{keyName(revokeId)}&rdquo; stops working right away. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeId(null)}>Cancel</Button>
            <Button variant="destructive" disabled={revoke.isLoading} onClick={() => revokeId && revoke.mutate({ organizationId: orgId, id: revokeId })}>
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
