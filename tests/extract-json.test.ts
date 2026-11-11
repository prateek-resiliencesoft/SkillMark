import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJson } from "../src/lib/ai/extract-json";

describe("extractJson", () => {
  it("parses plain object", () => {
    const v = extractJson<{ a: number }>('{"a":1}');
    assert.equal(v.a, 1);
  });

  it("strips trailing commas in arrays and objects", () => {
    const v = extractJson<{ techStack: string[]; experience: { role: string }[] }>(
      `{"techStack":["React","Node",],"experience":[{"role":"Dev",},]}`,
    );
    assert.deepEqual(v.techStack, ["React", "Node"]);
    assert.equal(v.experience[0].role, "Dev");
  });

  it("extracts from markdown fence", () => {
    const v = extractJson<{ name: string }>("```json\n{\"name\":\"Ada\"}\n```");
    assert.equal(v.name, "Ada");
  });

  it("repairs truncated object with open array", () => {
    const v = extractJson<{ projects: { name: string }[]; summary: string | null }>(
      `{"projects":[{"name":"A"},{"name":"B"`,
    );
    assert.equal(v.projects.length, 2);
    assert.equal(v.projects[1].name, "B");
  });

  it("escapes interior quotes inside strings", () => {
    const v = extractJson<{ summary: string }>(
      `{"summary":"Built "cool" apps"}`,
    );
    assert.ok(v.summary.includes("cool"));
  });
});
