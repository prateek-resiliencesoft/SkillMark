import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Theme transition overlay contains FlippingWordSwap animation without container or spinner", () => {
  const content = fs.readFileSync("src/components/ui/theme-transition.tsx", "utf8");
  assert.match(content, /FlippingWordSwap/);
  assert.match(content, /Dark/);
  assert.match(content, /Light/);
  assert.match(content, /Mode/);
  assert.match(content, /ThemeTransitionProvider/);
  assert.match(content, /ThemeSwitcherButton/);
  assert.match(content, /backdrop-blur/);

  // Must not have container card, loader, or progress bar in overlay
  assert.doesNotMatch(content, /animate-spin/);
  assert.doesNotMatch(content, /bg-card/);
});

test("Header and Sidebar integrate theme switcher button and transition hook", () => {
  const headerContent = fs.readFileSync("src/components/layout/header.tsx", "utf8");
  assert.match(headerContent, /ThemeSwitcherButton/);

  const sidebarContent = fs.readFileSync("src/components/layout/sidebar.tsx", "utf8");
  assert.match(sidebarContent, /useThemeTransition/);
});
