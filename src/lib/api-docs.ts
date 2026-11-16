/**
 * Helpers for the in-app API reference: read an OpenAPI 3.1 document and make
 * request snippets. Client-safe, no I/O.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type DocParam = {
  name: string;
  in: "path" | "query";
  required: boolean;
  description?: string;
  schema: any;
  example?: unknown;
};

export type DocResponse = { status: string; description: string; example: unknown };

export type DocOperation = {
  key: string;
  /** Stable id for links (#open=…): operationId, or METHOD-path. */
  id: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  scope: string | null;
  mcpTool: string | null;
  params: DocParam[];
  body: any | null;
  bodyExample: unknown;
  responses: DocResponse[];
  successStatus: string;
  example: unknown;
  responseSchema: any;
};

const METHODS = ["get", "post", "put", "patch", "delete"];

export function resolveRef(spec: any, obj: any): any {
  let cur = obj;
  for (let i = 0; i < 10 && cur && typeof cur === "object" && typeof cur.$ref === "string"; i++) {
    const parts = cur.$ref.replace(/^#\//, "").split("/");
    cur = parts.reduce((o: any, p: string) => (o ? o[p] : undefined), spec);
  }
  return cur;
}

export function listOperations(spec: any): DocOperation[] {
  const ops: DocOperation[] = [];
  for (const [path, item] of Object.entries<any>(spec?.paths ?? {})) {
    for (const m of METHODS) {
      const op = item?.[m];
      if (!op) continue;
      const params: DocParam[] = [...(item.parameters ?? []), ...(op.parameters ?? [])]
        .map((p: any) => resolveRef(spec, p))
        .filter((p: any) => p && (p.in === "path" || p.in === "query"))
        .map((p: any) => ({
          name: p.name,
          in: p.in,
          required: !!p.required || p.in === "path",
          description: p.description,
          schema: resolveRef(spec, p.schema) ?? {},
          example: p.example ?? resolveRef(spec, p.schema)?.example,
        }));
      const successStatus = Object.keys(op.responses ?? {}).find((s) => /^2\d\d$/.test(s)) ?? "200";
      const success = resolveRef(spec, op.responses?.[successStatus]);
      const json = success?.content?.["application/json"];
      const bodyContent = resolveRef(spec, op.requestBody)?.content?.["application/json"];
      const body = bodyContent?.schema;
      const responses: DocResponse[] = Object.entries<any>(op.responses ?? {})
        .map(([status, r]) => {
          const res = resolveRef(spec, r) ?? {};
          const c = res.content?.["application/json"];
          return {
            status,
            description: res.description ?? "",
            example: c?.example ?? (c?.examples ? Object.values<any>(c.examples)[0]?.value : undefined),
          };
        })
        .sort((a, b) => a.status.localeCompare(b.status));
      ops.push({
        key: `${m.toUpperCase()} ${path}`,
        id: op.operationId ?? `${m.toUpperCase()}-${path}`,
        method: m.toUpperCase(),
        path,
        tag: op.tags?.[0] ?? "Other",
        summary: op.summary ?? `${m.toUpperCase()} ${path}`,
        description: op.description ?? "",
        scope: op["x-scope"] ?? null,
        mcpTool: op["x-mcp-tool"] ?? null,
        params,
        body: body ? resolveRef(spec, body) : null,
        bodyExample: bodyContent?.example ?? (body ? sampleFromSchema(resolveRef(spec, body)) : undefined),
        responses,
        successStatus,
        example: json?.example ?? (json?.examples ? Object.values<any>(json.examples)[0]?.value : undefined),
        responseSchema: json?.schema ? resolveRef(spec, json.schema) : null,
      });
    }
  }
  return ops;
}

/** Operations grouped by tag, in the spec's tag order. */
export function groupByTag(spec: any, ops: DocOperation[]): { tag: string; description: string; ops: DocOperation[] }[] {
  const order: { name: string; description?: string }[] = spec?.tags ?? [];
  const groups = new Map<string, DocOperation[]>();
  for (const op of ops) groups.set(op.tag, [...(groups.get(op.tag) ?? []), op]);
  const names = [...order.map((t) => t.name), ...Array.from(groups.keys())].filter((n, i, a) => a.indexOf(n) === i && groups.has(n));
  return names.map((n) => ({ tag: n, description: order.find((t) => t.name === n)?.description ?? "", ops: groups.get(n)! }));
}

/** Build the request URL from path + query values (empty values are left out). */
export function buildUrl(base: string, op: Pick<DocOperation, "path" | "params">, values: Record<string, string>): string {
  let path = op.path;
  const qs = new URLSearchParams();
  for (const p of op.params) {
    const v = (values[p.name] ?? "").trim();
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(v || `{${p.name}}`));
    else if (v) qs.set(p.name, v);
  }
  const q = qs.toString();
  return `${base.replace(/\/$/, "")}${path}${q ? `?${q}` : ""}`;
}

const KEY_PLACEHOLDER = "$RSI_API_KEY";

export function snippets(url: string, method: string, body?: string | null) {
  const hasBody = !!body && method !== "GET";
  const pretty = hasBody ? body!.trim() : "";
  const curl = [
    `curl -X ${method} "${url}"`,
    `  -H "Authorization: Bearer ${KEY_PLACEHOLDER}"`,
    ...(hasBody ? [`  -H "Content-Type: application/json"`, `  -d '${pretty.replace(/'/g, "'\\''")}'`] : []),
  ].join(" \\\n");

  const js = [
    `const res = await fetch("${url}", {`,
    `  method: "${method}",`,
    `  headers: {`,
    `    Authorization: \`Bearer \${process.env.RSI_API_KEY}\`,`,
    ...(hasBody ? [`    "Content-Type": "application/json",`] : []),
    `  },`,
    ...(hasBody ? [`  body: JSON.stringify(${pretty}),`] : []),
    `});`,
    `const data = await res.json();`,
  ].join("\n");

  const py = [
    `import os, requests`,
    ``,
    `res = requests.${method.toLowerCase()}(`,
    `    "${url}",`,
    `    headers={"Authorization": f"Bearer {os.environ['RSI_API_KEY']}"},`,
    ...(hasBody ? [`    json=${toPython(pretty)},`] : []),
    `)`,
    `data = res.json()`,
  ].join("\n");

  return { curl, javascript: js, python: py };
}

function toPython(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 4)
      .replace(/\btrue\b/g, "True")
      .replace(/\bfalse\b/g, "False")
      .replace(/\bnull\b/g, "None")
      .split("\n")
      .join("\n    ");
  } catch {
    return json;
  }
}

/** Example JSON body built from a JSON schema (examples > defaults > types). */
export function sampleFromSchema(schema: any, depth = 0): unknown {
  if (!schema || depth > 5) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.anyOf) return sampleFromSchema(schema.anyOf.find((s: any) => s.type !== "null") ?? schema.anyOf[0], depth + 1);
  const t = Array.isArray(schema.type) ? schema.type.find((x: string) => x !== "null") : schema.type;
  if (t === "object" || schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries<any>(schema.properties ?? {})) {
      if ((schema.required ?? []).includes(k) || depth === 0) out[k] = sampleFromSchema(v, depth + 1);
    }
    return out;
  }
  if (t === "array") return [sampleFromSchema(schema.items, depth + 1)];
  if (t === "integer" || t === "number") return schema.minimum ?? 0;
  if (t === "boolean") return false;
  if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (schema.format === "email") return "candidate@example.com";
  return "";
}

/** Short type label for the params table. */
export function typeLabel(schema: any): string {
  if (!schema) return "any";
  if (Array.isArray(schema.enum)) return schema.enum.map((v: unknown) => JSON.stringify(v)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(typeLabel).join(" | ");
  const t = Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type ?? "any";
  if (t === "array") return `${typeLabel(schema.items)}[]`;
  return schema.format ? `${t} (${schema.format})` : t;
}

/** Open operations in the URL hash: #open=listSessions,getResult */
export function parseOpenHash(hash: string): string[] {
  const m = /(?:^#|&)open=([^&]*)/.exec(hash);
  return m ? m[1].split(",").map(decodeURIComponent).filter(Boolean) : [];
}

export function openHash(ids: string[]): string {
  return ids.length ? `#open=${ids.map(encodeURIComponent).join(",")}` : "";
}

/** Example value shown in the parameters table / prefilled in "Try it out". */
export function paramExample(p: DocParam): string {
  const v = p.example ?? p.schema?.example ?? p.schema?.default ?? (Array.isArray(p.schema?.enum) ? p.schema.enum[0] : undefined);
  return v === undefined || v === null ? "" : String(v);
}

/** Check a JSON body typed by the user; returns an error message, or null when valid. */
export function checkJson(text: string): string | null {
  if (!text.trim()) return "Body is empty.";
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid JSON";
  }
}

/**
 * Starting values for "Try it out". Path ids and optional filters start empty:
 * the documented examples are made-up ids, so sending them gives 404 or an empty list.
 */
export function tryDefaults(op: Pick<DocOperation, "params">): Record<string, string> {
  return Object.fromEntries(op.params.map((p) => [p.name, p.in === "query" && p.required ? paramExample(p) : ""]));
}

/** List endpoint that can supply real values for an id parameter, if any. */
export function idSource(path: string, paramName: string, paramIn: string): "/sessions" | "/interviews" | null {
  if (paramIn === "path" && /^\/sessions\/\{[^}]+\}/.test(path)) return "/sessions";
  if (paramIn === "path" && /^\/interviews\/\{[^}]+\}/.test(path)) return "/interviews";
  if (paramName === "interview_id") return "/interviews";
  return null;
}

/** Short label for a row from /sessions or /interviews in an id picker. */
export function pickLabel(row: any): string {
  const who = row.candidate_name || row.candidate_email || row.title || row.name || row.id;
  const extra = [row.interview_title, row.status].filter(Boolean).join(" · ");
  return extra ? `${who} — ${extra}` : String(who);
}
