import assert from "node:assert/strict";
import test from "node:test";
import {
  firstPlausibleNameFromSource,
  isJunkStoredName,
  isPlausiblePersonName,
  nameFromEmailLocalPart,
  nameFromFileName,
  resolveCandidateName,
  stripPageDecorations,
} from "../src/lib/documents/candidate-name";

test("stripPageDecorations drops HTML page comments and page-number lines", () => {
  const raw = `<!-- page 1 -->\nPage 1\nDewashish Hatekar\nSoftware Engineer\n\n<!-- page 2 -->\nPage 2 of 2\nExperience`;
  const cleaned = stripPageDecorations(raw);
  assert.doesNotMatch(cleaned, /<!--/);
  assert.doesNotMatch(cleaned, /^Page /m);
  assert.match(cleaned, /Dewashish Hatekar/);
});

test("isPlausiblePersonName rejects page markers, titles, and filenames", () => {
  for (const junk of [
    "Page 1",
    "page 1",
    "<!-- page 1 -->",
    "Page 1 of 2",
    "1 of 2",
    "-- 1 of 2 --",
    "Resume",
    "CV",
    "Curriculum Vitae",
    "Untitled",
    "Microsoft Word - John.pdf",
    "john-resume.pdf",
    "Software Engineer",
    "Contact Information",
  ]) {
    assert.equal(isPlausiblePersonName(junk), false, junk);
    assert.equal(isJunkStoredName(junk), true, junk);
  }
  for (const ok of ["Dewashish Hatekar", "R K Sharma", "A. Kumar", "Rajesh Kumar", "O'Brien", "Mary-Jane"]) {
    assert.equal(isPlausiblePersonName(ok), true, ok);
  }
});

test("firstPlausibleNameFromSource skips <!-- page 1 --> and Page 1 headers", () => {
  const md = `<!-- page 1 -->\nPage 1\nDewashish Hatekar\nSoftware Engineer\ndewashish@example.com\n`;
  assert.equal(firstPlausibleNameFromSource(md), "Dewashish Hatekar");
});

test("name falls back to email local part, then filename", () => {
  const fromEmail = resolveCandidateName({
    candidate: "Page 1",
    source: "<!-- page 1 -->\nResume\npriya.nair@example.com\n",
    email: "priya.nair@example.com",
    fileName: "scan.pdf",
  });
  assert.equal(fromEmail.name, "Priya Nair");
  assert.equal(fromEmail.source, "email");

  const fromFile = resolveCandidateName({
    candidate: "Page 1",
    source: "<!-- page 1 -->\nResume\n",
    email: "info@example.com",
    fileName: "John_Smith_Resume.pdf",
  });
  assert.equal(fromFile.name, "John Smith");
  assert.equal(fromFile.source, "fileName");
});

test("nameFromEmailLocalPart and nameFromFileName ignore generic labels", () => {
  assert.equal(nameFromEmailLocalPart("info@example.com"), null);
  assert.equal(nameFromEmailLocalPart("dewashish.h@example.com"), "Dewashish H");
  assert.equal(nameFromFileName("Resume.pdf"), null);
  assert.equal(nameFromFileName("Microsoft Word - Priya_Nair_CV.pdf"), "Priya Nair");
});
