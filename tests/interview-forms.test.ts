import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCurlJson,
  buildCurlMultipart,
  defaultFormFields,
  deriveApplicationStatus,
  normaliseDetected,
  sniffFileType,
  validateFieldDefinitions,
  validateSubmission,
} from "../src/lib/forms/schema";
import { generateApiKey, hashApiKey, keyHasScope } from "../src/lib/api-keys";

const fields = defaultFormFields();
const pdf = { name: "cv.pdf", size: 1000, detected: "pdf" };

test("default template is valid", () => {
  assert.deepEqual(validateFieldDefinitions(fields), []);
  assert.equal(fields.length, 10);
});

test("definition validation catches duplicates / bad keys / missing options", () => {
  const bad = [...fields, { ...fields[0], id: "x" }, { id: "y", key: "Bad Key", type: "dropdown" as const, label: "D", required: false }];
  const errs = validateFieldDefinitions(bad);
  assert.ok(errs.some((e) => e.includes("duplicate key")));
  assert.ok(errs.some((e) => e.includes("key must be")));
  assert.ok(errs.some((e) => e.includes("at least one option")));
});

const good = { full_name: "Jane Doe", email: "jane@example.com", phone: "+1 555 123 4567", years_of_experience: "3", skills: ["React", "SQL"], consent: "true" };

test("valid submission passes and coerces", () => {
  const r = validateSubmission(fields, good, { resume: [pdf] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.values.years_of_experience, 3);
  assert.equal(r.values.consent, true);
});

test("missing required + consent + bad email + bad option + unknown field", () => {
  const r = validateSubmission(fields, { ...good, email: "nope", consent: false, skills: ["Cobol"], foo: 1 }, {});
  const codes = r.errors.map((e) => `${e.field}:${e.code}`);
  assert.ok(codes.includes("resume:required"));
  assert.ok(codes.includes("email:invalid_email"));
  assert.ok(codes.includes("consent:required"));
  assert.ok(codes.includes("skills:invalid_option"));
  assert.ok(codes.includes("foo:unknown_field"));
});

test("file type, magic bytes and size enforced", () => {
  assert.ok(validateSubmission(fields, good, { resume: [{ name: "cv.exe", size: 10, detected: "binary" }] }).errors.some((e) => e.code === "invalid_file_type"));
  assert.ok(validateSubmission(fields, good, { resume: [{ name: "cv.pdf", size: 10, detected: "txt" }] }).errors.some((e) => e.code === "invalid_file_type"));
  assert.ok(validateSubmission(fields, good, { resume: [{ name: "cv.pdf", size: 11 * 1024 * 1024, detected: "pdf" }] }).errors.some((e) => e.code === "file_too_large"));
  assert.ok(validateSubmission(fields, good, { resume: [{ name: "cv.docx", size: 10, detected: "docx" }] }).ok);
});

test("magic byte sniffing", () => {
  assert.equal(sniffFileType(new TextEncoder().encode("%PDF-1.7 ...")), "pdf");
  assert.equal(normaliseDetected(sniffFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])), "a.docx"), "docx");
  assert.equal(sniffFileType(new Uint8Array([0x4d, 0x5a, 0, 0])), "binary");
});

test("status derivation", () => {
  assert.equal(deriveApplicationStatus("pending", null), "pending");
  assert.equal(deriveApplicationStatus("pending", { status: "IN_PROGRESS" }), "in_progress");
  assert.equal(deriveApplicationStatus("pending", { status: "COMPLETED" }), "completed");
  assert.equal(deriveApplicationStatus("pending", { status: "DISQUALIFIED" }), "disqualified");
  assert.equal(deriveApplicationStatus("cancelled", { status: "IN_PROGRESS" }), "cancelled");
});

test("cURL generated from actual fields", () => {
  const j = buildCurlJson("https://x.test", "frm_abc", fields);
  assert.ok(j.includes("/api/v1/interview-forms/frm_abc/applications"));
  assert.ok(j.includes("years_of_experience") && !j.includes('"resume"'));
  const m = buildCurlMultipart("https://x.test", "frm_abc", fields);
  assert.ok(m.includes("files[resume]=@./resume.pdf") && m.includes("answers[skills][]="));
  assert.ok(!m.trim().endsWith("\\"));
});

test("api keys: prefix, hash, scopes", () => {
  const k = generateApiKey("test");
  assert.match(k.key, /^dlv_test_[a-z0-9]{32}$/);
  assert.equal(k.hash, hashApiKey(k.key));
  assert.equal(k.hash.length, 64);
  assert.ok(keyHasScope(["*"], "applications:write"));
  assert.ok(keyHasScope(["applications:write"], "applications:read"));
  assert.ok(!keyHasScope(["forms:read"], "applications:write"));
});
