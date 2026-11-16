"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  buildUrl,
  checkJson,
  groupByTag,
  listOperations,
  openHash,
  paramExample,
  parseOpenHash,
  snippets,
  typeLabel,
  type DocOperation,
} from "@/lib/api-docs";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronRight, Copy, Download, Loader2, Lock, LockOpen } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const KEY_STORE = "rsi-docs-key";

const METHOD_BADGE: Record<string, string> = {
  GET: "bg-blue-600 text-white",
  POST: "bg-emerald-600 text-white",
  PUT: "bg-orange-500 text-white",
  PATCH: "bg-teal-600 text-white",
  DELETE: "bg-red-600 text-white",
};
const METHOD_ROW: Record<string, string> = {
  GET: "border-blue-500/40 bg-blue-500/[0.04]",
  POST: "border-emerald-500/40 bg-emerald-500/[0.04]",
  PUT: "border-orange-500/40 bg-orange-500/[0.04]",
  PATCH: "border-teal-500/40 bg-teal-500/[0.04]",
  DELETE: "border-red-500/40 bg-red-500/[0.04]",
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        "inline-flex w-16 shrink-0 justify-center rounded px-2 py-1 font-mono text-xs font-bold",
        METHOD_BADGE[method] ?? "bg-muted",
      )}
    >
      {method}
    </span>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground", className)}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={cn("relative rounded-lg border bg-muted/40", className)}>
      <CopyButton text={code} className="absolute right-2 top-2" />
      <pre className="max-h-[420px] overflow-auto p-3 pr-16 font-mono text-xs leading-relaxed">{code}</pre>
    </div>
  );
}

function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium",
            value === o.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b pb-1.5">
      <h4 className="text-sm font-semibold">{children}</h4>
      {right}
    </div>
  );
}

function SchemaFields({ schema }: { schema: any }) {
  const props = Object.entries<any>(schema?.properties ?? {});
  if (!props.length) return <p className="font-mono text-xs text-muted-foreground">{typeLabel(schema)}</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {props.map(([name, s]) => (
            <tr key={name} className="align-top">
              <td className="w-44 px-3 py-2">
                <code className="text-xs font-semibold">{name}</code>
                {(schema.required ?? []).includes(name) ? <span className="ml-1 text-[10px] text-red-600">required</span> : null}
              </td>
              <td className="px-3 py-2">
                <p className="font-mono text-[11px] text-muted-foreground">{typeLabel(s)}</p>
                {s.description ? <p className="mt-0.5 text-xs">{s.description}</p> : null}
                {s.properties ? (
                  <div className="mt-2">
                    <SchemaFields schema={s} />
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const pretty = (v: unknown) => (v === undefined ? "" : JSON.stringify(v, null, 2));

type Lang = "curl" | "javascript" | "python";
type Result =
  | {
      url: string;
      curl: string;
      status: number;
      statusText: string;
      ms: number;
      headers: [string, string][];
      body: string;
    }
  | { url: string; curl: string; error: string };

function Operation({
  op,
  base,
  apiKey,
  open,
  onToggle,
  onAuthorize,
}: {
  op: DocOperation;
  base: string;
  apiKey: string;
  open: boolean;
  onToggle: () => void;
  onAuthorize: () => void;
}) {
  const examples = useMemo(() => Object.fromEntries(op.params.map((p) => [p.name, paramExample(p)])), [op]);
  const exampleBody = op.body ? pretty(op.bodyExample ?? {}) : "";
  const [trying, setTrying] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(examples);
  const [body, setBody] = useState(exampleBody);
  const [lang, setLang] = useState<Lang>("curl");
  const [result, setResult] = useState<Result | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const docUrl = `${base}${op.path}`;
  const tryUrl = buildUrl(base, op, values);
  const bodyError = op.body && trying ? checkJson(body) : null;
  const code = snippets(trying ? tryUrl : buildUrl(base, op, examples), op.method, op.body ? (trying ? body : exampleBody) : null)[lang];

  function clear() {
    setResult(null);
    setNote(null);
    setValues(examples);
    setBody(exampleBody);
  }

  async function execute() {
    setNote(null);
    if (!apiKey.trim()) {
      setNote("Not authorized. Click “Authorize” at the top and paste an API key first.");
      return;
    }
    const missing = op.params.filter((p) => p.required && !(values[p.name] ?? "").trim()).map((p) => p.name);
    if (missing.length) {
      setNote(`Fill in the required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
      return;
    }
    if (bodyError) {
      setNote(`Body is not valid JSON: ${bodyError}`);
      return;
    }
    const curl = snippets(tryUrl, op.method, op.body ? body : null).curl;
    setSending(true);
    setResult(null);
    const started = performance.now();
    try {
      const res = await fetch(tryUrl, {
        method: op.method,
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          ...(op.body ? { "Content-Type": "application/json" } : {}),
        },
        body: op.body ? body : undefined,
      });
      const text = await res.text();
      let shown = text;
      try {
        shown = pretty(JSON.parse(text));
      } catch {
        /* not JSON */
      }
      const headers: [string, string][] = [];
      res.headers.forEach((v, k) => headers.push([k, v]));
      setResult({
        url: tryUrl,
        curl,
        status: res.status,
        statusText: res.statusText,
        ms: Math.round(performance.now() - started),
        headers,
        body: shown,
      });
    } catch (e) {
      setResult({
        url: tryUrl,
        curl,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div id={`op-${op.id}`} className={cn("scroll-mt-4 overflow-hidden rounded-lg border", METHOD_ROW[op.method] ?? "")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <MethodBadge method={op.method} />
        <code className="shrink-0 font-mono text-sm font-semibold">{op.path}</code>
        <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">{op.summary}</span>
        <span className="flex-1 sm:hidden" />
        {op.scope ? (
          <span title={`Needs scope: ${op.scope}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            <span className="hidden md:inline">{op.scope}</span>
          </span>
        ) : null}
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>

      {open ? (
        <div className="space-y-5 border-t bg-background p-4">
          <p className="text-sm text-muted-foreground sm:hidden">{op.summary}</p>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <MethodBadge method={op.method} />
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{docUrl}</code>
            <CopyButton text={docUrl} />
          </div>
          {op.description ? <p className="whitespace-pre-line text-sm">{op.description}</p> : null}
          {op.scope ? (
            <p className="text-xs text-muted-foreground">
              Required scope: <code className="rounded bg-muted px-1 py-0.5 text-foreground">{op.scope}</code>
            </p>
          ) : null}

          <div className="space-y-3">
            <SectionTitle
              right={
                <Button
                  size="sm"
                  variant={trying ? "outline" : "default"}
                  onClick={() => {
                    setTrying((t) => !t);
                    setNote(null);
                  }}
                >
                  {trying ? "Cancel" : "Try it out"}
                </Button>
              }
            >
              Parameters
            </SectionTitle>
            {op.params.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">In</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 font-medium">{trying ? "Value" : "Example"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {op.params.map((p) => (
                      <tr key={`${p.in}-${p.name}`} className="align-top">
                        <td className="px-3 py-2">
                          <code className="text-xs font-semibold">{p.name}</code>
                          {p.required ? <span className="ml-1 text-[10px] text-red-600">* required</span> : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{p.in}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{typeLabel(p.schema)}</td>
                        <td className="px-3 py-2 text-xs">{p.description ?? p.schema?.description ?? ""}</td>
                        <td className="min-w-[180px] px-3 py-2">
                          {trying ? (
                            Array.isArray(p.schema?.enum) ? (
                              <select
                                value={values[p.name] ?? ""}
                                onChange={(e) =>
                                  setValues((v) => ({
                                    ...v,
                                    [p.name]: e.target.value,
                                  }))
                                }
                                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                              >
                                <option value="">—</option>
                                {p.schema.enum.map((o: string) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                value={values[p.name] ?? ""}
                                onChange={(e) =>
                                  setValues((v) => ({
                                    ...v,
                                    [p.name]: e.target.value,
                                  }))
                                }
                                placeholder={p.name}
                                className="h-8 font-mono text-xs"
                              />
                            )
                          ) : (
                            <code className="break-all text-xs text-muted-foreground">{examples[p.name] || "—"}</code>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No parameters.</p>
            )}
          </div>

          {op.body ? (
            <div className="space-y-3">
              <SectionTitle right={<span className="text-xs text-muted-foreground">application/json</span>}>Request body</SectionTitle>
              {trying ? (
                <div className="space-y-1">
                  <Textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={Math.min(16, body.split("\n").length + 1)}
                    spellCheck={false}
                    className={cn("font-mono text-xs", bodyError && "border-destructive")}
                  />
                  {bodyError ? (
                    <p className="text-xs text-destructive">Invalid JSON: {bodyError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Valid JSON</p>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Example</p>
                    <CodeBlock code={exampleBody} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Schema</p>
                    <SchemaFields schema={op.body} />
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {trying ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button onClick={execute} disabled={sending} className="flex-1">
                  {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Execute
                </Button>
                <Button variant="outline" onClick={clear} disabled={sending}>
                  Clear
                </Button>
              </div>
              {note ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  <span>{note}</span>
                  {!apiKey.trim() ? (
                    <Button size="sm" variant="outline" onClick={onAuthorize}>
                      Authorize
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {result ? (
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs font-medium">cURL</p>
                    <CodeBlock code={result.curl} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium">Request URL</p>
                    <CodeBlock code={result.url} />
                  </div>
                  {"error" in result ? (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      Request failed: {result.error}
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-medium">Server response</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 font-mono font-semibold",
                            result.status < 300
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "bg-red-500/15 text-red-700 dark:text-red-300",
                          )}
                        >
                          {result.status} {result.statusText}
                        </span>
                        <span className="text-muted-foreground">{result.ms} ms</span>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium">Response body</p>
                        <CodeBlock code={result.body || "(empty)"} />
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium">Response headers</p>
                        <CodeBlock code={result.headers.map(([k, v]) => `${k}: ${v}`).join("\n") || "(none visible)"} />
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3">
            <SectionTitle>Responses</SectionTitle>
            <div className="divide-y rounded-lg border">
              {op.responses.map((r) => (
                <ResponseRow key={r.status} status={r.status} description={r.description} example={r.example} />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <SectionTitle>Code samples</SectionTitle>
            <Tabs<Lang>
              value={lang}
              onChange={setLang}
              options={[
                { id: "curl", label: "cURL" },
                { id: "javascript", label: "JavaScript" },
                { id: "python", label: "Python" },
              ]}
            />
            <CodeBlock code={code} />
            <p className="text-[11px] text-muted-foreground">Replace $RSI_API_KEY with your key, or set it as an environment variable.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResponseRow({ status, description, example }: { status: string; description: string; example: unknown }) {
  const [open, setOpen] = useState(status.startsWith("2"));
  const ok = status.startsWith("2");
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <code
          className={cn(
            "w-10 font-mono text-xs font-semibold",
            ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300",
          )}
        >
          {status}
        </code>
        <span className="flex-1 text-xs">{description}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open ? (
        <div className="px-3 pb-3">
          {example !== undefined ? <CodeBlock code={pretty(example)} /> : <p className="text-xs text-muted-foreground">No example.</p>}
        </div>
      ) : null}
    </div>
  );
}

function AuthorizeDialog({
  open,
  onOpenChange,
  apiKey,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  apiKey: string;
  onSave: (k: string) => void;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (open) setDraft("");
  }, [open]);
  const authorized = !!apiKey.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Authorize</DialogTitle>
          <DialogDescription>
            Paste an API key to use &ldquo;Try it out&rdquo;. It is sent as <code>Authorization: Bearer …</code> and kept only in this
            browser tab.
          </DialogDescription>
        </DialogHeader>
        {authorized ? (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            Authorized with <code className="font-mono text-xs">{apiKey.slice(0, 12)}…</code>
          </div>
        ) : (
          <form
            id="authorize-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) onSave(draft.trim());
            }}
            className="space-y-2"
          >
            <Input
              autoFocus
              type="password"
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="rsi_test_… or rsi_live_…"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              No key yet?{" "}
              <Link href="/developers?tab=keys" className="text-primary underline" onClick={() => onOpenChange(false)}>
                Create one in the Keys tab
              </Link>
              . Requests are real, so a test key with read scopes is a good choice.
            </p>
          </form>
        )}
        <DialogFooter>
          {authorized ? (
            <Button variant="outline" onClick={() => onSave("")}>
              Log out
            </Button>
          ) : (
            <Button type="submit" form="authorize-form" disabled={!draft.trim()}>
              Authorize
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApiReference() {
  const [spec, setSpec] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [openOps, setOpenOps] = useState<Set<string>>(new Set());
  const [closedTags, setClosedTags] = useState<Set<string>>(new Set());
  const [base, setBase] = useState("/api/v1");

  useEffect(() => {
    setBase(`${window.location.origin}/api/v1`);
    setApiKey(sessionStorage.getItem(KEY_STORE) ?? "");
    fetch("/api/v1/openapi.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSpec)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const ops = useMemo(() => (spec ? listOperations(spec) : []), [spec]);
  const groups = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const shown = term ? ops.filter((o) => `${o.summary} ${o.path} ${o.tag} ${o.method}`.toLowerCase().includes(term)) : ops;
    return groupByTag(spec, shown);
  }, [spec, ops, filter]);

  // Restore open rows from the URL hash (#open=listSessions,getResult) once the spec is in.
  useEffect(() => {
    if (!ops.length) return;
    const ids = parseOpenHash(window.location.hash).filter((id) => ops.some((o) => o.id === id));
    if (!ids.length) return;
    setOpenOps(new Set(ids));
    setTimeout(() => document.getElementById(`op-${ids[0]}`)?.scrollIntoView({ block: "start" }), 50);
  }, [ops]);

  const updateOpen = useCallback((next: Set<string>) => {
    setOpenOps(next);
    const url = `${window.location.pathname}${window.location.search}${openHash(Array.from(next))}`;
    window.history.replaceState(null, "", url);
  }, []);

  function saveKey(k: string) {
    setApiKey(k);
    if (k) sessionStorage.setItem(KEY_STORE, k);
    else sessionStorage.removeItem(KEY_STORE);
    if (k) setAuthOpen(false);
  }

  async function downloadSpec() {
    const blob = new Blob([JSON.stringify(spec, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "resiliencesoft-interview-openapi.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (error) return <p className="text-sm text-destructive">Could not load the API description: {error}</p>;
  if (!spec) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const authorized = !!apiKey.trim();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {spec.info?.title ?? "API"} <span className="ml-1 text-xs font-normal text-muted-foreground">v{spec.info?.version}</span>
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Base URL</span>
            <code className="truncate text-xs">{base}</code>
            <CopyButton text={base} />
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="text-primary underline">
              openapi.json
            </a>
            <button type="button" onClick={downloadSpec} className="inline-flex items-center gap-1 text-primary underline">
              <Download className="h-3 w-3" /> Download spec
            </button>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => setAuthOpen(true)}
          className={cn(authorized && "border-emerald-600 text-emerald-700 dark:text-emerald-300")}
        >
          {authorized ? <Lock className="mr-2 h-4 w-4" /> : <LockOpen className="mr-2 h-4 w-4" />}
          {authorized ? "Authorized" : "Authorize"}
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter endpoints" className="h-8 max-w-xs text-xs" />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setClosedTags(new Set());
              updateOpen(new Set(ops.map((o) => o.id)));
            }}
          >
            Expand all
          </Button>
          <Button size="sm" variant="outline" onClick={() => updateOpen(new Set())}>
            Collapse all
          </Button>
        </div>
      </div>

      {groups.length === 0 ? <p className="text-sm text-muted-foreground">No endpoint matches “{filter}”.</p> : null}

      {groups.map((g) => {
        const tagOpen = !closedTags.has(g.tag);
        return (
          <section key={g.tag} className="space-y-2">
            <button
              type="button"
              onClick={() =>
                setClosedTags((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.tag)) next.delete(g.tag);
                  else next.add(g.tag);
                  return next;
                })
              }
              aria-expanded={tagOpen}
              className="flex w-full items-center gap-2 border-b pb-2 text-left"
            >
              <h3 className="text-lg font-semibold">{g.tag}</h3>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{g.description}</span>
              <span className="text-xs text-muted-foreground">{g.ops.length}</span>
              {tagOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {tagOpen
              ? g.ops.map((o) => (
                  <Operation
                    key={o.key}
                    op={o}
                    base={base}
                    apiKey={apiKey}
                    open={openOps.has(o.id)}
                    onAuthorize={() => setAuthOpen(true)}
                    onToggle={() => {
                      const next = new Set(openOps);
                      if (next.has(o.id)) next.delete(o.id);
                      else next.add(o.id);
                      updateOpen(next);
                    }}
                  />
                ))
              : null}
          </section>
        );
      })}

      <AuthorizeDialog open={authOpen} onOpenChange={setAuthOpen} apiKey={apiKey} onSave={saveKey} />
    </div>
  );
}
