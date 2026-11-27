import assert from "node:assert/strict";
import test from "node:test";
import { heuristicCandidateProfile, validateProfile } from "../src/lib/documents/cv-profile";

test("heuristicCandidateProfile pulls email phone name from markdown", () => {
  const md = `# Dewashish H\n\nSoftware Engineer\ndewashish@example.com\n+91 98765 43210\n`;
  const { profile, reviewFlags } = heuristicCandidateProfile(md, "91", "AI timed out");
  assert.equal(profile.email, "dewashish@example.com");
  assert.ok(profile.phone?.includes("9876543210") || profile.phone?.endsWith("9876543210"));
  assert.match(profile.name ?? "", /Dewashish/i);
  assert.ok(reviewFlags.some((f) => /timed out|heuristics/i.test(f.reason)));
});

test("heuristicCandidateProfile no longer stores Page 1 as the name", () => {
  const md = `<!-- page 1 -->\nPage 1\nPriya Nair\npriya.nair@example.com\n+91 98765 43210\n`;
  const { profile } = heuristicCandidateProfile(md, "91", "AI timed out");
  assert.equal(profile.name, "Priya Nair");
  assert.equal(profile.email, "priya.nair@example.com");
});

test("validateProfile rejects an AI name of Page 1 even though the marker is in the source", () => {
  const md = `<!-- page 1 -->\nArjun Mehta\narjun.mehta@example.com\n`;
  const { profile, reviewFlags } = validateProfile(
    { name: "Page 1", email: "arjun.mehta@example.com" },
    md,
  );
  assert.equal(profile.name, "Arjun Mehta");
  assert.ok(reviewFlags.some((f) => /CV text/i.test(f.reason)));
});

test("heuristic uses the filename when the CV text has no name", () => {
  const md = `<!-- page 1 -->\nPage 1\nResume\ninfo@example.com\n`;
  const { profile, reviewFlags } = heuristicCandidateProfile(md, undefined, "AI timed out", {
    fileName: "Olivia_Chen_Resume.pdf",
  });
  assert.equal(profile.name, "Olivia Chen");
  assert.ok(reviewFlags.some((f) => /file name/i.test(f.reason)));
});
