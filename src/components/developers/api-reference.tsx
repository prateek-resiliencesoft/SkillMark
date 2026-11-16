"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  buildUrl,
  groupByTag,
  listOperations,
  sampleFromSchema,
  snippets,
  typeLabel,
  type DocOperation,
} from "@/lib/api-docs";
import { cn } from "@/lib/utils";
import { Check, Copy, Loader2, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const KEY_STORE = "rsi-docs-key";
const METHOD_STYLE: Record<string, string> = {
  GET: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300",
  POST: "text-blue-700 bg-blue-500/10 dark:text-blue-300",
  PATCH: "text-amber-700 bg-amber-500/10 dark:text-amber-300",
  PUT: "text-amber-700 bg-amber-500/10 dark:text-amber-300",
  DELETE: "text-red-700 bg-red-500/10 dark:text-red-300",
};

function MethodTag({ method, className }: { method: string; className?: string }) {
  return (
    <span className={cn("inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold", METHOD_STYLE[method], className)}>
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
      onClick={() => {
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

type Lang = "curl" | "javascript" | "python";
type Live = { status: number; ms: number; body: string } | { error: string } | null;

function SchemaFields({ schema }: { schema: any }) {
  const props = Object.entries<any>(schema?.properties ?? {});
  if (!props.length) return null;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {props.map(([name, s]) => (
            <tr key={name} className="align-top">
              <td className="w-48 px-3 py-2">
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

function Operation({ op, base, apiKey }: { op: DocOperation; base: string; apiKey: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState(() => (op.body ? JSON.stringify(sampleFromSchema(op.body), null, 2) : ""));
  const [lang, setLang] = useState<Lang>("curl");
  const [live, setLive] = useState<Live>(null);
  const [sending, setSending] = useState(false);

  const url = buildUrl(base, op, values);
  const code = snippets(url, op.method, op.body ? body : null)[lang];
  const missing = op.params.filter((p) => p.required && !(values[p.name] ?? "").trim()).map((p) => p.name);

  async function send() {
    setSending(true);
    setLive(null);
    const started = performance.now();
    try {
      const res = await fetch(url, {
        method: op.method,
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          ...(op.body ? { "Content-Type": "application/json" } : {}),
        },
        body: op.body && op.method !== "GET" ? body : undefined,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON */
      }
      setLive({ status: res.status, ms: Math.round(performance.now() - started), body: pretty });
    } catch (err) {
      setLive({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSending(false);
    }
  }

  return (
    <article id={op.key} className="grid gap-6 border-b py-10 first:pt-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <div className="space-y-2">
          <h2 className="font-heading text-xl font-bold tracking-tight">{op.summary}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <MethodTag method={op.method} />
            <code className="text-sm">{op.path}</code>
            {op.scope ? <Badge variant="outline" className="font-mono text-[10px] font-normal">{op.scope}</Badge> : null}
            {op.mcpTool ? <Badge variant="outline" className="text-[10px] font-normal">MCP: {op.mcpTool}</Badge> : null}
          </div>
          <p className="whitespace-pre-line text-sm text-muted-foreground">{op.description.replace(/\n\nRequires scope `[^`]+`\.$/, "")}</p>
        </div>

        {op.params.length ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Parameters</h3>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {op.params.map((p) => (
                    <tr key={`${p.in}-${p.name}`} className="align-top">
                      <td className="w-44 px-3 py-2">
                        <code className="text-xs font-semibold">{p.name}</code>
                        <p className="text-[10px] text-muted-foreground">
                          {p.in}
                          {p.required ? <span className="ml-1 text-red-600">required</span> : null}
                        </p>
                      </td>
                      <td className="space-y-1.5 px-3 py-2">
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {typeLabel(p.schema)}
                          {p.schema?.default !== undefined ? ` · default ${JSON.stringify(p.schema.default)}` : ""}
                        </p>
                        {p.description ? <p className="text-xs">{p.description}</p> : null}
                        <Input
                          value={values[p.name] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                          placeholder={Array.isArray(p.schema?.enum) ? p.schema.enum.join(", ") : p.name}
                          className="h-7 font-mono text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {op.body ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Request body</h3>
            <SchemaFields schema={op.body} />
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="font-mono text-xs" spellCheck={false} />
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={send} disabled={sending || !apiKey.trim() || missing.length > 0}>
            {sending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
            Send request
          </Button>
          <span className="text-xs text-muted-foreground">
            {!apiKey.trim()
              ? "Paste an API key at the top to try this."
              : missing.length
                ? `Fill ${missing.join(", ")}.`
                : op.method === "GET"
                  ? "Sends a real request with your key."
                  : "Sends a real request. This creates data and may email or message a candidate."}
          </span>
        </div>
      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
        <div className="space-y-2">
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
        </div>
        {live ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold">Response</span>
              {"error" in live ? (
                <span className="text-red-600">{live.error}</span>
              ) : (
                <>
                  <span className={cn("rounded px-1.5 py-0.5 font-mono", live.status < 300 ? "bg-emerald-500/10 text-emerald-700" : live.status < 500 ? "bg-amber-500/10 text-amber-700" : "bg-red-500/10 text-red-700")}>
                    {live.status}
                  </span>
                  <span className="text-muted-foreground">{live.ms} ms</span>
                </>
              )}
            </div>
            {"body" in live ? <CodeBlock code={live.body || "(empty)"} /> : null}
          </div>
        ) : op.example !== undefined ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold">
              Example response <span className="font-normal text-muted-foreground">· {op.successStatus}</span>
            </p>
            <CodeBlock code={JSON.stringify(op.example, null, 2)} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ApiReference() {
  const [spec, setSpec] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    setApiKey(sessionStorage.getItem(KEY_STORE) ?? "");
    fetch("/api/v1/openapi.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSpec)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const base = typeof window === "undefined" ? "/api/v1" : `${window.location.origin}/api/v1`;
  const ops = useMemo(() => (spec ? listOperations(spec) : []), [spec]);
  const groups = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const shown = term ? ops.filter((o) => `${o.summary} ${o.path} ${o.tag}`.toLowerCase().includes(term)) : ops;
    return groupByTag(spec, shown);
  }, [spec, ops, filter]);

  useEffect(() => {
    if (!ops.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    ops.forEach((o) => {
      const el = document.getElementById(o.key);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [ops, groups]);

  if (error) return <p className="text-sm text-destructive">Could not load the API description: {error}</p>;
  if (!spec) {
    return (
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an endpoint" className="mb-4 h-8 text-xs" />
        <nav className="space-y-5">
          {groups.map((g) => (
            <div key={g.tag}>
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.tag}</p>
              <ul className="space-y-0.5">
                {g.ops.map((o) => (
                  <li key={o.key}>
                    <a
                      href={`#${encodeURIComponent(o.key)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(o.key)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        setActive(o.key);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                        active === o.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <MethodTag method={o.method} className="w-11 text-center" />
                      <span className="truncate">{o.summary}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Base URL</p>
              <code className="text-xs text-muted-foreground">{base}</code>
            </div>
            <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="text-xs text-primary underline">
              OpenAPI 3.1 JSON
            </a>
          </div>
          <div className="space-y-1">
            <label htmlFor="docs-key" className="text-xs font-medium">
              API key for &ldquo;Send request&rdquo;
            </label>
            <Input
              id="docs-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                sessionStorage.setItem(KEY_STORE, e.target.value);
              }}
              placeholder="rsi_test_… or rsi_live_…"
              className="h-8 max-w-md font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Kept only in this browser tab. Use a test key with read scopes here; requests are real.
            </p>
          </div>
        </div>
        {groups.map((g) => (
          <section key={g.tag}>
            {g.ops.map((o) => (
              <Operation key={o.key} op={o} base={base} apiKey={apiKey} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
