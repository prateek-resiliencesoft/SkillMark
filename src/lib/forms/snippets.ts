import { buildJsonExample, isFileField, type FormField } from "./schema";

/** Backend/CRM code samples generated from a form's saved fields. */
export function buildNodeSnippet(base: string, formId: string, fields: FormField[]): string {
  const ex = buildJsonExample(fields);
  const files = fields.filter((f) => isFileField(f.type) && !f.hidden);
  const lines = [
    `// Node 18+ (server-side only — never ship the key to the browser)`,
    `import { readFile } from "node:fs/promises";`,
    ``,
    `const SKILLMARK_API_KEY = process.env.SKILLMARK_API_KEY; // dlv_live_… / dlv_test_…`,
    `const url = "${base}/api/v1/interview-forms/${formId}/applications";`,
    ``,
    `const form = new FormData();`,
    `form.append("candidate[name]", ${JSON.stringify(ex.candidate.name)});`,
    `form.append("candidate[email]", ${JSON.stringify(ex.candidate.email)});`,
    `form.append("candidate[phone]", ${JSON.stringify(ex.candidate.phone)});`,
  ];
  for (const [k, v] of Object.entries(ex.answers)) {
    if (Array.isArray(v)) for (const item of v) lines.push(`form.append("answers[${k}][]", ${JSON.stringify(String(item))});`);
    else lines.push(`form.append("answers[${k}]", ${JSON.stringify(String(v))});`);
  }
  for (const f of files) {
    const ext = f.allowedFileTypes?.[0] ?? "pdf";
    lines.push(`form.append("files[${f.key}]", new Blob([await readFile("./${f.key}.${ext}")]), "${f.key}.${ext}");${f.required ? "" : " // optional"}`);
  }
  lines.push(
    ``,
    `const res = await fetch(url, { method: "POST", headers: { Authorization: \`Bearer \${SKILLMARK_API_KEY}\` }, body: form });`,
    `const json = await res.json();`,
    `if (!res.ok) throw new Error(\`\${json.error.code}: \${json.error.message}\`); // json.error.details = per-field errors`,
    `console.log(json.data.id, json.data.interview_url); // send interview_url to the candidate`,
  );
  return lines.join("\n");
}

export function buildPythonSnippet(base: string, formId: string, fields: FormField[]): string {
  const ex = buildJsonExample(fields);
  const files = fields.filter((f) => isFileField(f.type) && !f.hidden);
  const data: string[] = [
    `    ("candidate[name]", ${JSON.stringify(ex.candidate.name)}),`,
    `    ("candidate[email]", ${JSON.stringify(ex.candidate.email)}),`,
    `    ("candidate[phone]", ${JSON.stringify(ex.candidate.phone)}),`,
  ];
  for (const [k, v] of Object.entries(ex.answers)) {
    if (Array.isArray(v)) for (const item of v) data.push(`    ("answers[${k}][]", ${JSON.stringify(String(item))}),`);
    else data.push(`    ("answers[${k}]", ${JSON.stringify(String(v))}),`);
  }
  const fl = files.map((f) => {
    const ext = f.allowedFileTypes?.[0] ?? "pdf";
    return `    ("files[${f.key}]", ("${f.key}.${ext}", open("${f.key}.${ext}", "rb"))),${f.required ? "" : "  # optional"}`;
  });
  return [
    `# pip install requests  (server-side only)`,
    `import os, requests`,
    ``,
    `url = "${base}/api/v1/interview-forms/${formId}/applications"`,
    `headers = {"Authorization": f"Bearer {os.environ['SKILLMARK_API_KEY']}"}`,
    `data = [`,
    ...data,
    `]`,
    `files = [`,
    ...fl,
    `]`,
    `r = requests.post(url, headers=headers, data=data, files=files, timeout=60)`,
    `body = r.json()`,
    `if not r.ok:`,
    `    raise RuntimeError(f"{body['error']['code']}: {body['error']['message']} {body['error'].get('details')}")`,
    `print(body["data"]["id"], body["data"]["interview_url"])`,
  ].join("\n");
}

export function buildPhpSnippet(base: string, formId: string, fields: FormField[]): string {
  const ex = buildJsonExample(fields);
  const files = fields.filter((f) => isFileField(f.type) && !f.hidden);
  const rows: string[] = [
    `  'candidate[name]'  => ${JSON.stringify(ex.candidate.name)},`,
    `  'candidate[email]' => ${JSON.stringify(ex.candidate.email)},`,
    `  'candidate[phone]' => ${JSON.stringify(ex.candidate.phone)},`,
  ];
  for (const [k, v] of Object.entries(ex.answers)) {
    if (Array.isArray(v)) v.forEach((item, i) => rows.push(`  'answers[${k}][${i}]' => ${JSON.stringify(String(item))},`));
    else rows.push(`  'answers[${k}]' => ${JSON.stringify(String(v))},`);
  }
  for (const f of files) {
    const ext = f.allowedFileTypes?.[0] ?? "pdf";
    rows.push(`  'files[${f.key}]' => new CURLFile(__DIR__ . '/${f.key}.${ext}'),${f.required ? "" : " // optional"}`);
  }
  return [
    `<?php`,
    `// Server-side only. Store the key in an environment variable.`,
    `$ch = curl_init('${base}/api/v1/interview-forms/${formId}/applications');`,
    `curl_setopt_array($ch, [`,
    `  CURLOPT_POST => true,`,
    `  CURLOPT_RETURNTRANSFER => true,`,
    `  CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . getenv('SKILLMARK_API_KEY')],`,
    `  CURLOPT_POSTFIELDS => [`,
    ...rows.map((r) => "  " + r),
    `  ],`,
    `]);`,
    `$body = json_decode(curl_exec($ch), true);`,
    `$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);`,
    `if ($status >= 400) { throw new Exception($body['error']['code'] . ': ' . $body['error']['message']); }`,
    `echo $body['data']['id'] . ' ' . $body['data']['interview_url'];`,
  ].join("\n");
}

export function mcpConfigs(mcpUrl: string) {
  const key = "YOUR_API_KEY";
  return {
    cursor: JSON.stringify({ mcpServers: { skillmark: { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    vscode: JSON.stringify({ servers: { skillmark: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    claudeCode: `claude mcp add --transport http skillmark ${mcpUrl} --header "Authorization: Bearer ${key}"`,
    remoteBridge: JSON.stringify({ mcpServers: { skillmark: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:Bearer ${SKILLMARK_API_KEY}"], env: { SKILLMARK_API_KEY: key } } } }, null, 2),
    windsurf: JSON.stringify({ mcpServers: { skillmark: { serverUrl: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    chatgptUrl: `${mcpUrl}?key=${key}`,
    curlInit: `curl -X POST "${mcpUrl}" \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    inspector: `npx @modelcontextprotocol/inspector --cli ${mcpUrl} --transport http --header "Authorization: Bearer ${key}" --method tools/list`,
  };
}
