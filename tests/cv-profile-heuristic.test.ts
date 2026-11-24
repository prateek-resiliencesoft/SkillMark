import assert from "node:assert/strict";
import test from "node:test";
import { heuristicCandidateProfile } from "../src/lib/documents/cv-profile";

test("heuristicCandidateProfile pulls email phone name from markdown", () => {
  const md = `# Dewashish H\n\nSoftware Engineer\ndewashish@example.com\n+91 98765 43210\n`;
  const { profile, reviewFlags } = heuristicCandidateProfile(md, "91", "AI timed out");
  assert.equal(profile.email, "dewashish@example.com");
  assert.ok(profile.phone?.includes("9876543210") || profile.phone?.endsWith("9876543210"));
  assert.match(profile.name ?? "", /Dewashish/i);
  assert.ok(reviewFlags.some((f) => /timed out|heuristics/i.test(f.reason)));
});
