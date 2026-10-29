/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { CodeBlock } from "@/components/integrations/code-block";
import { FormDocs } from "@/components/integrations/form-docs";
import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FormField } from "@/lib/forms/schema";
import { buildNodeSnippet, buildPhpSnippet, buildPythonSnippet, mcpConfigs } from "@/lib/forms/snippets";
import { trpc } from "@/lib/trpc/client";
import { Bot, Code2, FileText, Globe, KeyRound, Loader2, Webhook } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-emerald-600 text-white" : "bg-muted"}`}>{done ? "✓" : n}</div>
      <div><p className="text-sm font-medium">{title}</p><div className="text-xs text-muted-foreground">{children}</div></div>
    </div>
  );
}

function FormPicker({ forms, active, onPick }: { forms: any[]; active: string | null; onPick: (id: string) => void }) {
  if (!forms.length) return <p className="text-sm text-muted-foreground">No published forms yet. <Link className="text-primary underline" href="/integrations/forms">Build and publish an interview form</Link> first.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Form:</span>
      {forms.map((f) => (
        <button key={f.id} onClick={() => onPick(f.id)} className={`rounded-full border px-3 py-1 text-xs ${active === f.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
          {f.name} <span className="font-mono opacity-70">{f.publicId}</span>
        </button>
      ))}
    </div>
  );
}

function HostedTab({ formId }: { formId: string }) {
  const q = trpc.interviewForm.get.useQuery({ id: formId });
  if (!q.data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const hosted = `${q.data.baseUrl}/f/${q.data.publicId}`;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Hosted form & iframe embed</CardTitle><CardDescription>No code and no API key: share the link or embed it. Uses only the publishable form id, with server-side validation, uploads and per-IP rate limiting. After submitting, the candidate goes straight into the interview.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <CodeBlock label="Share this link" code={hosted} />
        <CodeBlock label="Embed on your careers page (iframe)" code={`<iframe src="${hosted}?embed=1" width="100%" height="900" style="border:0" title="Apply"></iframe>`} />
        <CodeBlock label="Apply button" code={`<a href="${hosted}" target="_blank" rel="noopener">Apply & start interview</a>`} />
        <Button variant="outline" asChild><a href={hosted} target="_blank" rel="noreferrer">Open hosted form</a></Button>
      </CardContent>
    </Card>
  );
}

function CodeTab({ formId }: { formId: string }) {
  const q = trpc.interviewForm.get.useQuery({ id: formId });
  if (!q.data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const fields = (q.data.fields ?? []) as FormField[];
  const b = q.data.baseUrl, id = q.data.publicId;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Backend / CRM / ATS examples</CardTitle><CardDescription>Generated from this form&apos;s fields. Run these on your server (or inside your CRM&apos;s server-side automation) with the key in an environment variable. The response contains the application id and the candidate&apos;s interview link; poll <code>GET /api/v1/applications/&#123;id&#125;</code> for status and results.</CardDescription></CardHeader>
      <CardContent>
        <Tabs defaultValue="node">
          <TabsList><TabsTrigger value="node">Node.js</TabsTrigger><TabsTrigger value="python">Python</TabsTrigger><TabsTrigger value="php">PHP</TabsTrigger></TabsList>
          <TabsContent value="node" className="mt-3"><CodeBlock label="Node.js (fetch + FormData)" code={buildNodeSnippet(b, id, fields)} /></TabsContent>
          <TabsContent value="python" className="mt-3"><CodeBlock label="Python (requests)" code={buildPythonSnippet(b, id, fields)} /></TabsContent>
          <TabsContent value="php" className="mt-3"><CodeBlock label="PHP (cURL)" code={buildPhpSnippet(b, id, fields)} /></TabsContent>
        </Tabs>
        <p className="mt-3 text-xs text-muted-foreground">A complete sample careers page with a backend proxy is in the repo at <code>examples/backend-proxy-integration.html</code> + <code>examples/backend-proxy-server.mjs</code>.</p>
      </CardContent>
    </Card>
  );
}

function McpTab({ baseUrl }: { baseUrl: string }) {
  const mcpUrl = `${baseUrl}/api/mcp`;
  const c = mcpConfigs(mcpUrl);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">MCP server for AI assistants</CardTitle>
          <CardDescription>Connect Cursor, Claude, VS Code Copilot, Windsurf, Antigravity, ChatGPT and other MCP clients to Skillmark. They can list forms, read form schemas, submit candidates, check application status and results, list/create interviews and read session results — all scoped to your organization and your key&apos;s permissions. Every call appears in the API usage log.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <CodeBlock label="MCP server URL (Streamable HTTP)" code={mcpUrl} />
          <p className="text-xs text-muted-foreground">Auth: <code>Authorization: Bearer dlv_…</code> (create a key under <Link className="text-primary underline" href="/integrations/api-keys">API keys</Link>; a read-only key — forms:read + applications:read + interviews:read — is safest for assistants). Tools: <code>list_interview_forms</code>, <code>get_interview_form</code>, <code>submit_application</code>, <code>list_applications</code>, <code>get_application</code>, <code>list_interviews</code>, <code>get_interview</code>, <code>create_interview</code>, <code>list_sessions</code>, <code>get_session_results</code>.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Client setup</CardTitle><CardDescription>Replace YOUR_API_KEY with your key. Restart / refresh the client after editing its config.</CardDescription></CardHeader>
        <CardContent>
          <Tabs defaultValue="cursor">
            <TabsList className="flex-wrap">
              <TabsTrigger value="cursor">Cursor</TabsTrigger>
              <TabsTrigger value="claude">Claude Desktop / Antigravity</TabsTrigger>
              <TabsTrigger value="claudecode">Claude Code</TabsTrigger>
              <TabsTrigger value="vscode">VS Code</TabsTrigger>
              <TabsTrigger value="windsurf">Windsurf</TabsTrigger>
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="test">Test</TabsTrigger>
            </TabsList>
            <TabsContent value="cursor" className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">Add to <code>~/.cursor/mcp.json</code> (global) or <code>.cursor/mcp.json</code> (project).</p><CodeBlock label="mcp.json" code={c.cursor} /></TabsContent>
            <TabsContent value="claude" className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">Clients that only launch local (stdio) servers use the <code>mcp-remote</code> bridge (needs Node.js). Claude Desktop: Settings → Developer → Edit Config (<code>claude_desktop_config.json</code>). Antigravity: Agent panel → MCP Servers → Manage → View raw config (<code>mcp_config.json</code>). The same block works for most other stdio-only clients.</p><CodeBlock label="claude_desktop_config.json / mcp_config.json" code={c.remoteBridge} /></TabsContent>
            <TabsContent value="claudecode" className="mt-3"><CodeBlock label="Terminal" code={c.claudeCode} /></TabsContent>
            <TabsContent value="vscode" className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">Add to <code>.vscode/mcp.json</code> (or user settings → MCP), then start it from the MCP view and use it in Copilot agent mode.</p><CodeBlock label=".vscode/mcp.json" code={c.vscode} /></TabsContent>
            <TabsContent value="windsurf" className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">Add to <code>~/.codeium/windsurf/mcp_config.json</code>. If your Windsurf version does not support remote headers, use the mcp-remote block from the Claude tab.</p><CodeBlock label="mcp_config.json" code={c.windsurf} /></TabsContent>
            <TabsContent value="chatgpt" className="mt-3 space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">ChatGPT limitation</p>
                <p className="mt-1">ChatGPT custom MCP apps/connectors (developer mode, Business/Enterprise/Edu workspaces; web only) support only <strong>OAuth</strong> or <strong>No authentication</strong> — there is no field for a static API key header. Skillmark does not implement OAuth yet. As a workaround you can choose <em>No authentication</em> and put the key in the URL below. The key then lives inside the connector URL (and may appear in proxy/server logs): create a <strong>dedicated read-only key</strong> just for ChatGPT and rotate it if the URL is shared. The server must be reachable over public HTTPS.</p>
              </div>
              <CodeBlock label="ChatGPT → Settings → Apps → Create (developer mode) → Server URL" code={c.chatgptUrl} />
            </TabsContent>
            <TabsContent value="test" className="mt-3 space-y-2">
              <CodeBlock label="cURL (tools/list)" code={c.curlInit} />
              <CodeBlock label="MCP Inspector CLI" code={c.inspector} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function MyIntegrationsInner() {
  const { currentOrg } = useOrg();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("form");
  const [tab, setTab] = useState(params.get("tab") ?? "rest");
  const forms = trpc.interviewForm.list.useQuery({ organizationId: currentOrg?.id ?? "" }, { enabled: !!currentOrg?.id });
  const keys = trpc.apiKey.list.useQuery();
  const logs = trpc.interviewForm.usageLogs.useQuery({ organizationId: currentOrg?.id ?? "", limit: 50 }, { enabled: !!currentOrg?.id, refetchInterval: 20000 });
  const all = (forms.data ?? []) as any[];
  const published = all.filter((f) => f.status === "published" || f.id === selected);
  const active = selected ?? published[0]?.id ?? null;
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  const hasKey = (keys.data ?? []).some((k: any) => k.isActive);
  const pick = (id: string) => router.replace(`/integrations?form=${id}&tab=${tab}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Integrations</h1>
          <p className="text-sm text-muted-foreground">How to connect your website, CRM, ATS or AI assistant to Skillmark.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/integrations/api-keys"><KeyRound className="mr-1.5 h-4 w-4" />Manage API keys</Link></Button>
          <Button asChild><Link href="/integrations/forms">Interview Forms</Link></Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">How to connect your service</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Step n={1} title="Create an API key" done={hasKey}>Under <Link className="text-primary underline" href="/integrations/api-keys">Manage API keys</Link>. Start with a <code>dlv_test_</code> key; the secret is shown once. Not needed for the hosted form.</Step>
          <Step n={2} title="Build & publish an interview form" done={all.some((f) => f.status === "published")}>Choose candidate fields and configure the interview in <Link className="text-primary underline" href="/integrations/forms">Interview Forms</Link>, then Publish to get a <code>frm_…</code> id.</Step>
          <Step n={3} title="Pick a connection method" done={(logs.data ?? []).length > 0}>REST API from your backend, hosted form / iframe, ready-made code for your CRM, or MCP for AI assistants. Results flow back via <code>GET /applications/&#123;id&#125;</code>.</Step>
        </CardContent>
      </Card>

      {forms.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <Tabs value={tab} onValueChange={(v) => setTab(v)}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="rest"><Code2 className="mr-1.5 h-4 w-4" />REST API</TabsTrigger>
            <TabsTrigger value="hosted"><Globe className="mr-1.5 h-4 w-4" />Hosted form & embed</TabsTrigger>
            <TabsTrigger value="code"><FileText className="mr-1.5 h-4 w-4" />Backend / CRM code</TabsTrigger>
            <TabsTrigger value="mcp"><Bot className="mr-1.5 h-4 w-4" />MCP (AI assistants)</TabsTrigger>
            <TabsTrigger value="webhooks"><Webhook className="mr-1.5 h-4 w-4" />Webhooks</TabsTrigger>
          </TabsList>
          {(["rest", "hosted", "code"] as const).map((t) => (
            <TabsContent key={t} value={t} className="mt-4 space-y-4">
              <FormPicker forms={published} active={active} onPick={pick} />
              {active && (t === "rest" ? <FormDocs formId={active} /> : t === "hosted" ? <HostedTab formId={active} /> : <CodeTab formId={active} />)}
            </TabsContent>
          ))}
          <TabsContent value="mcp" className="mt-4"><McpTab baseUrl={baseUrl} /></TabsContent>
          <TabsContent value="webhooks" className="mt-4">
            <Card><CardContent className="space-y-2 py-6 text-sm">
              <p className="font-medium">Webhooks for applications — coming soon <Badge variant="secondary" className="ml-1">not available yet</Badge></p>
              <p className="text-muted-foreground">Status-change callbacks for interview-form applications are not built yet. For now, poll <code>GET /api/v1/interview-forms/&#123;formId&#125;/applications</code> or <code>GET /api/v1/applications/&#123;id&#125;</code> (e.g. every few minutes) to pick up <code>in_progress</code>, <code>completed</code> and <code>disqualified</code> statuses and results.</p>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">API usage log</CardTitle><CardDescription>Last 50 authenticated API and MCP calls for this organization.</CardDescription></CardHeader>
        <CardContent>
          {!logs.data?.length ? <p className="text-sm text-muted-foreground">No API calls yet.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1.5">Time</th><th>Key</th><th>Method</th><th>Endpoint</th><th>Status</th></tr></thead>
              <tbody>
                {logs.data.map((l: any) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-1.5">{new Date(l.createdAt).toLocaleString()}</td>
                    <td>{l.apiKey ? `${l.apiKey.name} (${l.apiKey.environment})` : "—"}</td>
                    <td>{l.method}</td>
                    <td className="font-mono">{l.endpoint}</td>
                    <td><span className={l.status < 300 ? "text-emerald-600" : l.status < 500 ? "text-amber-600" : "text-red-600"}>{l.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function MyIntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <MyIntegrationsInner />
    </Suspense>
  );
}
