import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("tailwind.config.ts includes electric violet primary and legacy color mapping", () => {
  const config = fs.readFileSync("tailwind.config.ts", "utf8");

  // Primary scale
  assert.match(config, /50:\s*["']#f0f2ff["']/i);
  assert.match(config, /100:\s*["']#e4e7fe["']/i);
  assert.match(config, /200:\s*["']#cad0fd["']/i);
  assert.match(config, /300:\s*["']#a3adfb["']/i);
  assert.match(config, /400:\s*["']#7882f7["']/i);
  assert.match(config, /500:\s*["']#5941F2["']/i);
  assert.match(config, /600:\s*["']#0511F2["']/i);

  // Terracotta legacy mapping
  assert.match(config, /terracotta:\s*["']#5941F2["']/i);

  // mk card and bg restored design system colors
  assert.match(config, /card:\s*["']#E8E4DC["']/i);
  assert.match(config, /bg:\s*["']#F5F3EF["']/i);

  // Surface sidebar
  assert.match(config, /sidebar:\s*["']#111113["']/i);
});
