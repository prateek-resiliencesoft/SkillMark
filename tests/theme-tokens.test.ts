import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("globals.css contains :root light mode tokens", () => {
  const css = fs.readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /:root\s*\{[\s\S]*--background:\s*230\s+40%\s+98%/);
  assert.match(css, /:root\s*\{[\s\S]*--border:\s*225\s+30%\s+91%/);
  assert.match(css, /:root\s*\{[\s\S]*--radius:\s*0\.875rem/);
});

test("globals.css contains dark mode tokens from design reference", () => {
  const css = fs.readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\.dark\s*\{[\s\S]*--background:\s*0\s+0%\s+5\.1%/);
  assert.match(css, /\.dark\s*\{[\s\S]*--card:\s*240\s+6%\s+8\.5%/);
  assert.match(css, /\.dark\s*\{[\s\S]*--primary:\s*248\s+87%\s+60%/);
  assert.match(css, /\.dark\s*\{[\s\S]*--border:\s*240\s+6%\s+15%/);
});
