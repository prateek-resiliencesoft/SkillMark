# Dark Mode Theme Redesign & Harmonized Light Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the high-quality dark theme and harmonized light theme based on the reference design, featuring deep zinc surfaces, elevated containers, hairline borders, and electric violet accents.

**Architecture:** Update CSS custom properties in `src/app/globals.css` for both `.dark` and `:root`, reconfigure Tailwind color maps and border radii in `tailwind.config.ts`, set dark mode as the default in `src/components/providers.tsx`, and polish the dashboard navigation and active container states.

**Tech Stack:** Next.js 14, Tailwind CSS, Radix UI, next-themes.

## Global Constraints

- Dark mode background: `240 7% 12%` (`#1c1c1f`)
- Dark mode card/surface: `240 6% 14%` (`#222226`)
- Dark mode border/input: `240 7% 19%` (`#2e2e35`)
- Dark mode sidebar: `#28282c`
- Primary brand accent: `247 90% 62%` (`#5944f6`)
- Dark mode secondary/pill fill: `245 13% 18%` (`#272733`)
- Light mode background: `240 20% 98%` (`#f8f8fc`)
- Light mode card: `0 0% 100%` (`#ffffff`)
- Light mode border: `240 16% 90%` (`#e2e2ec`)
- Default theme: `"dark"`
- Border radius: `--radius: 0.875rem` (14px)

---

### Task 1: Update CSS Design Tokens in `src/app/globals.css`

**Files:**
- Modify: `src/app/globals.css:6-67`

**Interfaces:**
- Consumes: CSS `:root` and `.dark` variables
- Produces: Updated HSL values for all standard design tokens and container radius

- [ ] **Step 1: Write token verification test script**

Create `tests/theme-tokens.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("globals.css contains dark mode tokens from design reference", () => {
  const css = fs.readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /--background:\s*240\s+7%\s+12%/);
  assert.match(css, /--card:\s*240\s+6%\s+14%/);
  assert.match(css, /--primary:\s*247\s+90%\s+62%/);
  assert.match(css, /--border:\s*240\s+7%\s+19%/);
  assert.match(css, /--radius:\s*0\.875rem/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/theme-tokens.test.ts`
Expected: FAIL (assertion mismatch)

- [ ] **Step 3: Update `src/app/globals.css` with new token values**

Update `:root` and `.dark` in `src/app/globals.css`:
```css
@layer base {
  :root {
    --background: 240 20% 98%;
    --foreground: 240 10% 10%;

    --card: 0 0% 100%;
    --card-foreground: 240 10% 10%;

    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 10%;

    --primary: 247 90% 62%;
    --primary-foreground: 0 0% 100%;

    --secondary: 245 25% 94%;
    --secondary-foreground: 247 60% 35%;

    --muted: 240 14% 94%;
    --muted-foreground: 240 5% 42%;

    --accent: 247 80% 96%;
    --accent-foreground: 247 90% 62%;

    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;

    --border: 240 16% 90%;
    --input: 240 16% 90%;
    --ring: 247 90% 62%;

    --radius: 0.875rem;
  }

  .dark {
    --background: 240 7% 12%;
    --foreground: 0 0% 100%;

    --card: 240 6% 14%;
    --card-foreground: 0 0% 100%;

    --popover: 240 6% 14%;
    --popover-foreground: 0 0% 100%;

    --primary: 247 90% 62%;
    --primary-foreground: 0 0% 100%;

    --secondary: 245 13% 18%;
    --secondary-foreground: 240 5% 85%;

    --muted: 245 13% 18%;
    --muted-foreground: 220 9% 65%;

    --accent: 247 50% 22%;
    --accent-foreground: 247 90% 75%;

    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;

    --border: 240 7% 19%;
    --input: 240 7% 19%;
    --ring: 247 90% 62%;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/theme-tokens.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/app/globals.css tests/theme-tokens.test.ts
git commit -m "style: update CSS design tokens for dark and light themes"
```

---

### Task 2: Update Tailwind Theme Configuration in `tailwind.config.ts`

**Files:**
- Modify: `tailwind.config.ts:45-138`

**Interfaces:**
- Consumes: Tailwind theme color maps
- Produces: Electric violet primary scale and legacy brand/mk color bridge

- [ ] **Step 1: Write test for Tailwind palette updates**

Create `tests/tailwind-palette.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("tailwind.config.ts includes electric violet primary and legacy color mapping", () => {
  const config = fs.readFileSync("tailwind.config.ts", "utf8");
  assert.match(config, /500:\s*["']#7c3aed["']/);
  assert.match(config, /600:\s*["']#5944f6["']/);
  assert.match(config, /terracotta:\s*["']#5944f6["']/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/tailwind-palette.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `tailwind.config.ts`**

Update `primary`, `mk`, `brand`, and `surface` color maps in `tailwind.config.ts`:
- Change `primary` shades to:
  - `50`: `"#f5f3ff"`
  - `100`: `"#ede9fe"`
  - `200`: `"#ddd6fe"`
  - `300`: `"#c4b5fd"`
  - `400`: `"#a78bfa"`
  - `500`: `"#7c3aed"`
  - `600`: `"#5944f6"`
  - `700`: `"#4c35e0"`
  - `800`: `"#3f29c2"`
  - `900`: `"#2e1b9b"`
- Update `mk.terracotta` and `brand.terracotta` to `"#5944f6"`
- Update `mk.card` to `"hsl(var(--card))"` and `mk.bg` to `"hsl(var(--background))"`
- Add `surface.sidebar: "#28282c"`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/tailwind-palette.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add tailwind.config.ts tests/tailwind-palette.test.ts
git commit -m "style: configure Tailwind violet primary palette and theme bridge"
```

---

### Task 3: Set Default Theme to Dark in `src/components/providers.tsx`

**Files:**
- Modify: `src/components/providers.tsx:39-45`

**Interfaces:**
- Consumes: `<ThemeProvider>` from `next-themes`
- Produces: Default `"dark"` theme on first load

- [ ] **Step 1: Write test for ThemeProvider configuration**

Create `tests/theme-provider.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("providers.tsx sets defaultTheme to dark", () => {
  const content = fs.readFileSync("src/components/providers.tsx", "utf8");
  assert.match(content, /defaultTheme="dark"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/theme-provider.test.ts`
Expected: FAIL (`defaultTheme="system"` currently)

- [ ] **Step 3: Update `src/components/providers.tsx`**

Set `defaultTheme="dark"` in `<ThemeProvider>`:
```tsx
<ThemeProvider
  attribute="class"
  defaultTheme="dark"
  enableSystem={false}
>
  {children}
</ThemeProvider>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/theme-provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/components/providers.tsx tests/theme-provider.test.ts
git commit -m "feat: set default application theme to dark"
```

---

### Task 4: Polish Dashboard Sidebar & Card Containers

**Files:**
- Inspect & Modify: `src/components/layout/sidebar.tsx` (or dashboard shell equivalent)
- Modify: `src/app/globals.css` (custom container utilities)

**Interfaces:**
- Consumes: Tailwind classes and CSS variables
- Produces: Dribbble-style active tabs with purple glow and border highlight, rounded-2xl cards

- [ ] **Step 1: Inspect and enhance dashboard shell components**

Review layout elements in `src/components/layout/` and add styling for:
- Sidebar dark background `#28282c` / `dark:bg-[#28282c]`
- Active tab pill styling with subtle violet glow: `dark:bg-primary/15 dark:text-white dark:border-l-2 dark:border-primary`
- Pill badges with `rounded-full`

- [ ] **Step 2: Verify existing web tests pass**

Run: `npm run test:web`
Expected: All existing unit and relay tests pass

- [ ] **Step 3: Commit changes**

```bash
git add -A
git commit -m "style: refine dashboard sidebar and container active states"
```

---

### Task 5: End-to-End Visual & Verification Gate

**Files:**
- None (verification only)

- [ ] **Step 1: Run complete test suite**

Run: `npm run test:web`
Expected: All tests pass

- [ ] **Step 2: Verify Next.js dev server builds and serves pages without runtime errors**

Run: `curl -sI http://localhost:3000/dashboard` and check logs
Expected: HTTP 200/307, no compile errors

- [ ] **Step 3: Clean up temporary test files**

Remove `tests/theme-tokens.test.ts`, `tests/tailwind-palette.test.ts`, and `tests/theme-provider.test.ts` (or retain as regression tests).
Commit the final implementation.
