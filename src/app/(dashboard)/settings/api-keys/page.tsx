/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Ban, Copy, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const SCOPES = [
  { id: "*", label: "Full access" },
  { id: "forms:read", label: "Read forms" },
  { id: "applications:write", label: "Submit applications" },
  { id: "applications:read", label: "Read applications & results" },
  { id: "interviews:read", label: "Read interviews" },
  { id: "interviews:write", label: "Manage interviews" },
] as const;

type Scope = (typeof SCOPES)[number]["id"];
const sel = "h-9 w-full rounded-md border bg-background px-3 text-sm";

function fmt(v: string | null | undefined) {
  return v ? new Date(v).toLocaleString() : "Never";
}

/** API key management: secrets are shown exactly once; only SHA-256 hashes are stored. */
export default function ApiKeysPage() {
  const { toast } = useToast();
  const { currentOrg } = useOrg();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [env, setEnv] = useState<"live" | "test">("test");
  const [scopes, setScopes] = useState<Scope[]>(["*"]);
  const [expiresLocal, setExpiresLocal] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const list = trpc.apiKey.list.useQuery();
  const onErr = (e: { message: string }) => toast({ title: "Error", description: e.message, variant: "destructive" });
  const done = (key: string) => { setRevealed(key); utils.apiKey.list.invalidate(); };
  const create = trpc.apiKey.create.useMutation({ onSuccess: (d) => { done(d.key); setName(""); setExpiresLocal(""); }, onError: onErr });
  const rotate = trpc.apiKey.rotate.useMutation({ onSuccess: (d) => done(d.key), onError: onErr });
  const revoke = trpc.apiKey.revoke.useMutation({ onSuccess: () => { utils.apiKey.list.invalidate(); toast({ title: "Key revoked" }); }, onError: onErr });
  const del = trpc.apiKey.delete.useMutation({ onSuccess: () => utils.apiKey.list.invalidate(), onError: onErr });

  const toggleScope = (s: Scope) => {
    if (s === "*") return setScopes(["*"]);
    const next = scopes.filter((x) => x !== "*");
    setScopes(next.includes(s) ? next.filter((x) => x !== s).length ? next.filter((x) => x !== s) : ["*"] : [...next, s]);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">API Keys</h2>
        <p className="text-sm text-muted-foreground">
          Keys authenticate server-to-server calls to the Skillmark API. Only a SHA-256 hash is stored — the secret is shown once at creation.{" "}
          <Link href="/integrations" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Integration docs <ExternalLink className="h-3 w-3" /></Link>
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Create a key</CardTitle><CardDescription>Use test keys while developing; applications created with them are marked <code>test</code>.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Careers site backend" /></div>
            <div className="space-y-1"><Label>Environment</Label><select className={sel} value={env} onChange={(e) => setEnv(e.target.value as "live" | "test")}><option value="test">Test (dlv_test_…)</option><option value="live">Live (dlv_live_…)</option></select></div>
            <div className="space-y-1"><Label>Expires (optional)</Label><Input type="datetime-local" value={expiresLocal} onChange={(e) => setExpiresLocal(e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>Permissions</Label>
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((s) => (
                <button key={s.id} type="button" onClick={() => toggleScope(s.id)} className={`rounded-full border px-3 py-1 text-xs ${scopes.includes(s.id) ? "border-primary bg-primary text-primary-foreground" : ""}`}>{s.label}</button>
              ))}
            </div>
          </div>
          <Button disabled={!name.trim() || create.isLoading} onClick={() => create.mutate({ name: name.trim(), environment: env, scopes, organizationId: currentOrg?.id, expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() : undefined })}>
            {create.isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Generate key
          </Button>
        </CardContent>
      </Card>

      <Dialog open={!!revealed} onOpenChange={(o) => { if (!o) setRevealed(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key now</DialogTitle>
            <DialogDescription>This is the only time the full key is shown. Store it in your backend secrets manager. Never put it in browser JavaScript.</DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-md bg-muted p-3 text-xs">{revealed}</code>
          <DialogFooter>
            <Button onClick={async () => { if (revealed) await navigator.clipboard.writeText(revealed); toast({ title: "Copied" }); }}><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
            <Button variant="outline" onClick={() => setRevealed(null)}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader><CardTitle className="text-base">Your keys</CardTitle></CardHeader>
        <CardContent>
          {list.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !list.data?.length ? <p className="text-sm text-muted-foreground">No keys yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Name</th><th>Key</th><th>Env</th><th>Permissions</th><th>Status</th><th>Last used</th><th>Created</th><th></th></tr></thead>
                <tbody>
                  {list.data.map((k: any) => (
                    <tr key={k.id} className="border-t">
                      <td className="py-2 font-medium">{k.name}</td>
                      <td className="font-mono text-xs">{k.maskedKey}</td>
                      <td><Badge variant={k.environment === "live" ? "default" : "secondary"}>{k.environment}</Badge></td>
                      <td className="text-xs">{(k.scopes ?? ["*"]).join(", ")}</td>
                      <td>{k.isActive ? <Badge variant="outline">active</Badge> : <Badge variant="destructive">revoked</Badge>}</td>
                      <td className="text-xs">{fmt(k.lastUsedAt)}</td>
                      <td className="text-xs">{fmt(k.createdAt)}</td>
                      <td className="whitespace-nowrap text-right">
                        {k.isActive && <Button size="icon" variant="ghost" title="Rotate (revoke + new key)" onClick={() => { if (confirm("Rotate this key? The current key stops working immediately.")) rotate.mutate({ id: k.id }); }}><RefreshCw className="h-4 w-4" /></Button>}
                        {k.isActive && <Button size="icon" variant="ghost" title="Revoke" onClick={() => { if (confirm("Revoke this key?")) revoke.mutate({ id: k.id }); }}><Ban className="h-4 w-4" /></Button>}
                        {!k.isActive && <Button size="icon" variant="ghost" title="Delete" onClick={() => del.mutate({ id: k.id })}><Trash2 className="h-4 w-4" /></Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
