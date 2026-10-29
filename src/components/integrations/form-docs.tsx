"use client";

import { CodeBlock } from "@/components/integrations/code-block";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ERROR_EXAMPLES,
  buildCurlJson,
  buildCurlMultipart,
  buildJsonExample,
  buildSuccessExample,
  fieldTypeForDocs,
  isFileField,
  type FormField,
} from "@/lib/forms/schema";
import { trpc } from "@/lib/trpc/client";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export function FormDocs({ formId }: { formId: string }) {
  const q = trpc.interviewForm.get.useQuery({ id: formId });
  if (!q.data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const f = q.data;
  const base = f.baseUrl;
  const fields = (f.fields ?? []) as FormField[];
  const visible = fields.filter((x) => !x.hidden);
  const endpoint = `${base}/api/v1/interview-forms/${f.publicId}/applications`;
  const hosted = `${base}/f/${f.publicId}`;
  const fileFields = visible.filter((x) => isFileField(x.type));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{f.name} <Badge className="ml-2" variant={f.status === "published" ? "default" : "secondary"}>{f.status}</Badge></CardTitle>
          <CardDescription>Generated from the saved form configuration. Re-publishing or editing fields updates this page automatically.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div><span className="text-muted-foreground">API base URL:</span> <code>{base}/api/v1</code></div>
          <div><span className="text-muted-foreground">interview_form_id:</span> <code>{f.publicId}</code></div>
          <div className="sm:col-span-2"><span className="text-muted-foreground">Hosted form URL:</span> <a className="text-primary underline ml-1 font-mono text-xs" href={hosted} target="_blank" rel="noreferrer">{hosted}</a></div>
          <div className="sm:col-span-2"><span className="text-muted-foreground">Endpoint:</span> <code>POST {endpoint}</code></div>
          <div className="sm:col-span-2"><span className="text-muted-foreground">Headers:</span> <code>Authorization: Bearer dlv_live_…</code> (or <code>dlv_test_…</code>) and <code>Content-Type: application/json</code> or <code>multipart/form-data</code></div>
          <div className="sm:col-span-2 text-xs text-muted-foreground">
            Authentication: create a key under <Link className="text-primary underline" href="/integrations/api-keys">API Keys</Link>. Keys are secret — call this API only from your backend/CRM, never from browser JavaScript. Test keys (<code>dlv_test_</code>) mark applications as test. Limits: 60 req/min per key, 25 MB per request.
          </div>
          {f.status !== "published" && <div className="sm:col-span-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">This form is not published — submissions return 409 FORM_NOT_PUBLISHED.</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Request body</CardTitle><CardDescription><code>candidate</code> (name required, email, phone) + <code>answers</code> keyed by field key. Identity fields (full_name, email, phone) are filled from <code>candidate</code> automatically.</CardDescription></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1.5">Key</th><th>Send as</th><th>Type</th><th>Required</th><th>Rules</th></tr></thead>
              <tbody>
                {visible.map((x) => (
                  <tr key={x.id} className="border-t">
                    <td className="py-1.5 font-mono">{x.key}</td>
                    <td className="font-mono">{isFileField(x.type) ? `files[${x.key}]` : `answers.${x.key}`}</td>
                    <td>{fieldTypeForDocs(x)}</td>
                    <td>{x.required ? "required" : "optional"}</td>
                    <td className="text-muted-foreground">
                      {[x.options?.length ? `one of: ${x.options.join(", ")}` : "", x.minLength != null ? `min ${x.minLength} chars` : "", x.maxLength != null ? `max ${x.maxLength} chars` : "", x.min != null ? `min ${x.min}` : "", x.max != null ? `max ${x.max}` : "", isFileField(x.type) ? `${(x.allowedFileTypes ?? []).join("/") || "any"} ≤ ${x.maxFileSizeMb ?? 10} MB${x.multiple ? ", multiple" : ""}` : "", x.type === "email" ? "valid email" : "", x.type === "url" ? "http(s) URL" : "", x.type === "date" ? "YYYY-MM-DD" : "", x.pattern ? `regex ${x.pattern}` : ""].filter(Boolean).join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><CodeBlock label="JSON body" code={JSON.stringify(buildJsonExample(fields), null, 2)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">cURL</CardTitle>
          <CardDescription>{fileFields.length ? <>This form has file fields ({fileFields.map((x) => x.key).join(", ")}). Files must be sent with <code>multipart/form-data</code> as <code>files[&lt;key&gt;]</code>; other values as <code>candidate[name]</code>, <code>answers[&lt;key&gt;]</code>, arrays as <code>answers[&lt;key&gt;][]</code>. Server checks extension, magic bytes and size.</> : "This form has no file fields; JSON is enough."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fileFields.some((x) => x.required) ? null : <CodeBlock label="JSON" code={buildCurlJson(base, f.publicId, fields)} />}
          <CodeBlock label="multipart/form-data (with files)" code={buildCurlMultipart(base, f.publicId, fields)} />
          <CodeBlock label="Check application status" code={`curl "${base}/api/v1/applications/APPLICATION_ID" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`} />
          <CodeBlock label="List applications for this form" code={`curl "${base}/api/v1/interview-forms/${f.publicId}/applications" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Responses</CardTitle><CardDescription>Statuses: submitted → pending (interview link issued) → in_progress → completed / disqualified / cancelled. Results appear in GET /applications/&#123;id&#125; once completed.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <CodeBlock label="201 Created" code={JSON.stringify(buildSuccessExample(base, f.publicId), null, 2)} />
          {Object.values(ERROR_EXAMPLES).map((e) => <CodeBlock key={e.status} label={`${e.status} error`} code={JSON.stringify(e.body, null, 2)} />)}
        </CardContent>
      </Card>

    </div>
  );
}

