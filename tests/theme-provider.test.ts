import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("providers.tsx sets defaultTheme to light and enables system preference", () => {
  const content = fs.readFileSync("src/components/providers.tsx", "utf8");
  assert.match(content, /defaultTheme="light"/);
  assert.match(content, /enableSystem=\{true\}/);
});
