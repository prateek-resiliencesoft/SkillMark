/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { w3Db } from "./sec-w3-db";

const dir = mkdtempSync(path.join(os.tmpdir(), "skillmark-w3-forms-"));
process.env.STORAGE_DIR = dir;
process.env.STORAGE_CAP_GATE = "off";
process.env.AUTH_SECRET = "test-secret-for-w3-forms-0123456789";

import {
  canonicalMimeForDetected,
  normaliseDetected,
  sniffFileType,
  validateSubmission,
  zipMatchesOfficeType,
  type FormField,
} from "@/lib/forms/schema";

async function serve(key: string, body: Buffer, contentType: string) {
  const { storage } = await import("@/lib/storage");
  await storage.from("applications").upload(key, body, { contentType, upsert: true });
  const { data } = await storage.from("applications").createSignedUrl(key, 60);
  const { GET, HEAD } = await import("@/app/api/files/[bucket]/[...path]/route");
  const params = { bucket: "applications", path: key.split("/") };
  const url = new URL(data!.signedUrl, "http://app.test");
  return { get: await GET(new Request(url), { params }), head: await HEAD(new Request(url, { method: "HEAD" }), { params }) };
}

describe("SKILLMARK-FILES-INLINE-MIME-XSS", () => {
  it("serves stored HTML/SVG as a sandboxed, non-sniffed attachment", async () => {
    for (const [name, type] of [
      ["x.html", "text/html"],
      ["x.svg", "image/svg+xml"],
      ["x.xhtml", "application/xhtml+xml"],
    ]) {
      const { get, head } = await serve(`orgs/o/projects/p/candidates/c/other/${name}`, Buffer.from("<script>alert(1)</script>"), type);
      for (const res of [get, head]) {
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "application/octet-stream", name);
        assert.match(res.headers.get("content-disposition") ?? "", /^attachment;/);
        assert.equal(res.headers.get("x-content-type-options"), "nosniff");
        assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'.*sandbox/);
      }
    }
  });

  it("documents download; recordings and images stay inline but sandboxed", async () => {
    const pdf = await serve("orgs/o/projects/p/candidates/c/CV/cv.pdf", Buffer.from("%PDF-1.4 x"), "application/pdf");
    assert.match(pdf.get.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(pdf.get.headers.get("content-type"), "application/pdf");

    const rec = await serve("orgs/o/projects/p/candidates/c/recordings/a.webm", Buffer.alloc(10), "audio/webm;codecs=opus");
    assert.equal(rec.get.headers.get("content-disposition"), null);
    assert.equal(rec.get.headers.get("content-type"), "audio/webm;codecs=opus");
    assert.equal(rec.get.headers.get("x-content-type-options"), "nosniff");
    assert.match(rec.get.headers.get("content-security-policy") ?? "", /sandbox/);
  });
});

describe("SKILLMARK-FORMS-UNVALIDATED-FILE-TYPE", () => {
  const field = (p: Partial<FormField>): FormField => ({ id: "f", key: "doc", type: "document", label: "Doc", required: false, ...p });
  const info = (name: string, bytes: Uint8Array, type = "") => ({
    name,
    size: bytes.length,
    type,
    detected: normaliseDetected(sniffFileType(bytes), name),
  });
  const enc = (s: string) => new TextEncoder().encode(s);

  it("rejects HTML/SVG disguised as a .txt cover letter", () => {
    const f = field({ key: "cover_letter", type: "cover_letter", allowedFileTypes: ["pdf", "docx", "txt"] });
    const svg = info("cover.txt", enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    assert.equal(svg.detected, "html");
    assert.ok(validateSubmission([f], {}, { cover_letter: [svg] }).errors.some((e) => e.code === "invalid_file_type"));
    const ok = info("cover.txt", enc("Dear team, I would like to apply."));
    assert.equal(validateSubmission([f], {}, { cover_letter: [ok] }).ok, true);
  });

  it("rejects an active client Content-Type even on a valid PDF", () => {
    const f = field({ key: "resume", type: "resume", allowedFileTypes: ["pdf"] });
    const poly = info("resume.pdf", enc("%PDF-1.4 <html><script>alert(1)</script></html>"), "text/html");
    assert.ok(validateSubmission([f], {}, { resume: [poly] }).errors.some((e) => e.code === "invalid_file_type"));
    const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const pdfOk = info("resume.pdf", enc("%PDF-1.4 hello"), "application/pdf");
    assert.equal(validateSubmission([f], {}, { resume: [pdfOk] }).ok, true);
    assert.equal(validateSubmission([field({ key: "resume", type: "resume", allowedFileTypes: ["docx"] })], {}, {
      resume: [{ name: "a.docx", size: 10, type: docxType, detected: "docx" }],
    }).ok, true);
  });

  it("applies a safe default allowlist when the field has none", () => {
    const f = field({ allowedFileTypes: [] });
    const html = info("page.html", enc("<html><body>x</body></html>"));
    const exe = info("tool.exe", new Uint8Array([0x4d, 0x5a, 0, 0]));
    assert.ok(validateSubmission([f], {}, { doc: [html] }).errors.some((e) => e.code === "invalid_file_type"));
    assert.ok(validateSubmission([f], {}, { doc: [exe] }).errors.some((e) => e.code === "invalid_file_type"));
    assert.equal(validateSubmission([f], {}, { doc: [info("cv.pdf", enc("%PDF-1.7"))] }).ok, true);
  });

  it("a ZIP only passes as .docx when it has Word entries", () => {
    const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc("payload/evil.html")]);
    const realish = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc("[Content_Types].xml...word/document.xml")]);
    assert.equal(zipMatchesOfficeType(fakeZip, "docx"), false);
    assert.equal(zipMatchesOfficeType(realish, "docx"), true);
  });

  it("stored content types are derived server-side", () => {
    assert.equal(canonicalMimeForDetected("pdf"), "application/pdf");
    assert.equal(canonicalMimeForDetected("txt"), "text/plain; charset=utf-8");
    assert.equal(canonicalMimeForDetected("html"), "application/octet-stream");
    assert.equal(canonicalMimeForDetected(null), "application/octet-stream");
  });
});

function multipartRequest(form: FormData) {
  return new Request("http://app.test/api/public/forms/frm_abcdefgh", { method: "POST", body: form });
}

describe("SKILLMARK-FORMS-MULTIPART-DOS", () => {
  it("caps chunked bodies without Content-Length while streaming", async () => {
    const { parseSubmissionRequest, MAX_REQUEST_BYTES } = await import("@/server/integrations/applications");
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_REQUEST_BYTES + chunk.length) return controller.close();
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const req = new Request("http://app.test/x", {
      method: "POST",
      body,
      headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    await assert.rejects(parseSubmissionRequest(req), (e: any) => e.status === 413);
    assert.ok(sent <= MAX_REQUEST_BYTES + 2 * chunk.length, "stopped reading soon after the cap");
  });

  it("refuses JSON bodies over 1 MB even when chunked", async () => {
    const { parseSubmissionRequest } = await import("@/server/integrations/applications");
    const big = new TextEncoder().encode(JSON.stringify({ answers: { a: "x".repeat(1_100_000) } }));
    const req = new Request("http://app.test/x", {
      method: "POST",
      body: new ReadableStream({ start(c) { c.enqueue(big); c.close(); } }),
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    await assert.rejects(parseSubmissionRequest(req), (e: any) => e.status === 413);
  });

  it("caps multipart part count, file count and text bytes", async () => {
    const { parseSubmissionRequest, MAX_MULTIPART_PARTS, MAX_SUBMISSION_FILES } = await import("@/server/integrations/applications");
    const many = new FormData();
    for (let i = 0; i <= MAX_MULTIPART_PARTS; i++) many.append("answers[skills][]", "x");
    await assert.rejects(parseSubmissionRequest(multipartRequest(many)), (e: any) => e.status === 413);

    const files = new FormData();
    for (let i = 0; i <= MAX_SUBMISSION_FILES; i++) files.append("files[additional_documents][]", new Blob(["a"]), `${i}.txt`);
    await assert.rejects(parseSubmissionRequest(multipartRequest(files)), (e: any) => e.status === 413);

    const text = new FormData();
    text.append("answers", JSON.stringify({ a: "x".repeat(1_100_000) }));
    await assert.rejects(parseSubmissionRequest(multipartRequest(text)), (e: any) => e.status === 413);
  });

  it("appends repeated keys in place and ignores prototype keys", async () => {
    const { parseSubmissionRequest } = await import("@/server/integrations/applications");
    const form = new FormData();
    for (let i = 0; i < 150; i++) form.append("answers[skills][]", `s${i}`);
    form.append("answers[__proto__]", "polluted");
    const out = await parseSubmissionRequest(multipartRequest(form));
    assert.equal((out.answers.skills as string[]).length, 150);
    assert.equal(Object.getPrototypeOf(out.answers), null);
    assert.equal(({} as any).polluted, undefined);
  });

  it("validateSubmission caps files per field", () => {
    const f: FormField = { id: "f", key: "docs", type: "document", label: "Docs", required: false, multiple: true, allowedFileTypes: ["pdf"] };
    const list = Array.from({ length: 11 }, (_, i) => ({ name: `${i}.pdf`, size: 10, detected: "pdf" }));
    assert.ok(validateSubmission([f], {}, { docs: list }).errors.some((e) => e.code === "too_many_files"));
  });
});

describe("SKILLMARK-FORMS-UPLOAD-COLLISION-ORPHAN", () => {
  const ORG = "org-forms";
  const fields: FormField[] = [
    { id: "1", key: "full_name", type: "short_text", label: "Name", required: true },
    { id: "2", key: "cover_letter", type: "cover_letter", label: "Cover", required: false, allowedFileTypes: ["pdf"] },
    { id: "3", key: "additional_documents", type: "document", label: "Docs", required: false, allowedFileTypes: ["pdf"], multiple: true },
  ];
  const form = {
    id: "form-1",
    publicId: "frm_abcdefgh",
    organizationId: ORG,
    projectId: "proj",
    userId: "u",
    interviewId: "int-1",
    name: "Form",
    description: null,
    status: "published",
    fields,
    config: {},
    settings: { sendInviteEmail: false, sendInviteWhatsapp: false },
    publishedAt: null,
    createdAt: "",
    updatedAt: "",
  };
  const pdf = (s: string) => ({ name: "doc.pdf", type: "text/plain", bytes: new TextEncoder().encode(`%PDF-1.4 ${s}`) });

  async function withDb(db: ReturnType<typeof w3Db>, fn: () => Promise<void>) {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const original = supabaseAdmin.from;
    (supabaseAdmin as any).from = db.from.bind(db);
    try {
      await fn();
    } finally {
      (supabaseAdmin as any).from = original;
    }
  }

  it("same filename in two fields is stored twice with server-derived types", async () => {
    const db = w3Db({ candidates: [], applications: [], interviews: [{ id: "int-1", projectId: "proj" }] });
    await withDb(db, async () => {
      const { createApplication } = await import("@/server/integrations/applications");
      await createApplication({
        form: form as any,
        input: { candidate: { name: "Jane Doe" }, answers: {}, files: { cover_letter: [pdf("a")], additional_documents: [pdf("b")] } },
        source: "hosted",
        baseUrl: "http://app.test",
      });
    });
    const app = db.tables.applications[0];
    const a = app.files.cover_letter[0];
    const b = app.files.additional_documents[0];
    assert.notEqual(a.path, b.path);
    assert.equal(a.type, "application/pdf");
    assert.ok(existsSync(path.join(dir, a.path)) && existsSync(path.join(dir, b.path)));
  });

  it("rolls back stored files and the candidate row when the application insert fails", async () => {
    const db = w3Db({ candidates: [], applications: [], interviews: [{ id: "int-1", projectId: "proj2" }] }, { failInsert: ["applications"] });
    await withDb(db, async () => {
      const { createApplication } = await import("@/server/integrations/applications");
      await assert.rejects(
        createApplication({
          form: { ...form, projectId: "proj2" } as any,
          input: { candidate: { name: "John Roe" }, answers: {}, files: { cover_letter: [pdf("a")] } },
          source: "hosted",
          baseUrl: "http://app.test",
        }),
        (e: any) => e.status === 500,
      );
    });
    assert.equal(db.tables.candidates.length, 0, "candidate row removed");
    const folder = path.join(dir, `orgs/${ORG}/projects/proj2/candidates`);
    const leftovers = existsSync(folder) ? readdirSync(folder, { recursive: true }).filter((n) => String(n).endsWith(".pdf")) : [];
    assert.deepEqual(leftovers, []);
  });
});

describe("SKILLMARK-AUTH-CLIENTIP-CF-HEADER-SPOOFING (applications / public forms)", () => {
  it("applications.clientIp ignores a client-supplied CF-Connecting-IP", async () => {
    const { clientIp } = await import("@/server/integrations/applications");
    delete process.env.TRUST_CF_CONNECTING_IP;
    const req = new Request("http://app.test", { headers: { "cf-connecting-ip": "6.6.6.6", "x-real-ip": "10.0.0.1" } });
    assert.equal(clientIp(req), "10.0.0.1");
  });

  it("public form POST rejects malformed form ids before recording a submit", async () => {
    const { POST } = await import("@/app/api/public/forms/[formId]/route");
    const res = await POST(new Request("http://app.test/api/public/forms/x", { method: "POST", headers: { "x-real-ip": "10.9.9.9" } }), {
      params: { formId: "../../" + "a".repeat(5000) },
    });
    assert.equal(res.status, 404);
  });
});
