import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  jobRoleFromTitle,
  parseJobRoleFromObjective,
  resolveJobRole,
} from "@/lib/job-role";

describe("parseJobRoleFromObjective", () => {
  it("reads Role: line", () => {
    assert.equal(parseJobRoleFromObjective("Role: Flutter Developer\n\nJob description:\n…"), "Flutter Developer");
  });
});

describe("jobRoleFromTitle", () => {
  it("strips interview noise and batch suffix", () => {
    assert.equal(jobRoleFromTitle("MERN Stack Developer Interview · Ada"), "MERN Stack Developer");
    assert.equal(jobRoleFromTitle("HR Screening Round 1"), "HR");
  });
});

describe("resolveJobRole", () => {
  it("prefers stored, then objective, then title", () => {
    assert.equal(resolveJobRole({ jobRole: "  Flutter Dev  ", title: "X Interview" }), "Flutter Dev");
    assert.equal(
      resolveJobRole({ title: "X Interview", objective: "Role: Backend Engineer\nMore" }),
      "Backend Engineer",
    );
    assert.equal(resolveJobRole({ title: "Product Manager Interview" }), "Product Manager");
  });
});
