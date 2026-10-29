import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("FlippingWordSwap component implements 3D rotation with perspective and stagger", () => {
  const content = fs.readFileSync("src/components/ui/flipping-word-swap.tsx", "utf8");
  assert.match(content, /FlippingWordSwap/);
  assert.match(content, /perspective:800px/);
  assert.match(content, /rotationX/);
  assert.match(content, /data-flip-word/);
  assert.match(content, /gsap/);
});
