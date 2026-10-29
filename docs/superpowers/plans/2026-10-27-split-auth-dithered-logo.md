# Interactive Split Auth Page & Dithered Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a split-screen authentication experience featuring an interactive dithered particle logo canvas on the left and an animated segmented auth portal (Sign In / Sign Up) on the right.

**Architecture:** Create `src/components/auth/auth-split-view.tsx` containing the canvas hero, animated tab slider, and form panels; update `src/app/(auth)/layout.tsx`, `src/app/(auth)/login/page.tsx`, and `src/app/(auth)/register/page.tsx`.

**Tech Stack:** Next.js 14, Tailwind CSS, Lucide icons, Supabase Auth, Canvas 2D particle simulation.

---

### Task 1: Create Interactive Split Auth Component (`src/components/auth/auth-split-view.tsx`)
- Implement left hero column with `DitheredLogo`, radial glow, "SKILLMARK", "Measure what matters", and feature chips.
- Implement right auth column with animated sliding segmented pill: `[ Sign In | Create Account ]`.
- Include full credentials validation, loading state, error toasts, and password toggle.

### Task 2: Update Auth Layout & Route Pages
- Update `src/app/(auth)/layout.tsx` to provide a full-height canvas container.
- Update `src/app/(auth)/login/page.tsx` to render `<AuthSplitView defaultTab="login" />`.
- Update `src/app/(auth)/register/page.tsx` to render `<AuthSplitView defaultTab="register" />`.

### Task 3: Verification & Test Suite
- Run `npx tsc --noEmit` to verify type safety.
- Run `npm run test:web` to ensure no regression in existing tests.
- Verify HTTP response and module compilation in dev server.
