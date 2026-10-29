# Section-Based Question Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to define sets of premade questions grouped by sections (Screening Round, Technical Round, HR Round, etc.) on the Questions tab with include/exclude toggles, and automatically include them in AI interview generation as complementary questions and during new interview creation.

**Architecture:** Dedicated `question_bank_sections` and `question_bank_items` tables with tRPC CRUD routers, automatic seeding of standard rounds, prompt enrichment in AI generator to generate complementary non-duplicate questions, and UI controls in `/questions`, `/interviews/new`, and `ai-generator.tsx`.

**Tech Stack:** Next.js 14 App Router, tRPC v10, Supabase PostgreSQL, Tailwind CSS, Lucide React, Node.js Test Runner.

## Global Constraints
- Preserve existing interview questions table and schema without breaking changes.
- Multi-tenant isolation: all bank items and sections must be scoped to `organizationId`.
- Theme & Styling: strictly adhere to the project's 5-color palette (`#5941F2`, `#0511F2`, `#296CF2`, `#277FF2`, `#0D0D0D`) and `IBM Plex Sans Condensed` font.
- Evidence before completion: zero TypeScript errors (`npx tsc --noEmit`) and passing web test suite.

---

### Task 1: Database Migration for Question Bank

**Files:**
- Create: `supabase/migrations/004_question_bank.sql`
- Execute: `docker exec supabase_db_aural psql ...`
- Test: Verify tables exist via psql

- [x] **Step 1: Write migration SQL**
  Create `supabase/migrations/004_question_bank.sql` containing `question_bank_sections` and `question_bank_items` with appropriate indices, foreign keys, and cascading deletes.
- [x] **Step 2: Apply migration to local Supabase database**
  Execute SQL file against `supabase_db_aural` container.
- [x] **Step 3: Verify table creation**
  Query `information_schema.tables` to ensure both tables are present.

---

### Task 2: tRPC Router for Question Bank

**Files:**
- Create: `src/server/routers/question-bank.ts`
- Modify: `src/server/routers/_app.ts`
- Test: `tests/question-bank-router.test.ts`

- [x] **Step 1: Write router unit test**
  Create `tests/question-bank-router.test.ts` testing section listing, auto-seed defaults, question addition, and toggle logic.
- [x] **Step 2: Implement `questionBankRouter`**
  Implement procedures:
  - `list` (with auto-seeding of Screening, Technical, HR rounds on first access)
  - `createSection`, `updateSection`, `deleteSection`
  - `createItem`, `updateItem`, `deleteItem`, `toggleItem`
  - `getEnabledQuestions`
- [x] **Step 3: Register in `_app.ts`**
  Add `questionBank: questionBankRouter` to `appRouter`.
- [x] **Step 4: Run tests & verify**
  Run `node --import tsx --test tests/question-bank-router.test.ts`.

---

### Task 3: AI Prompt & Generation Pipeline Integration

**Files:**
- Modify: `src/lib/ai/prompts/generator.ts`
- Modify: `src/app/api/ai/generate/route.ts`
- Test: `tests/generator-prompt.test.ts`

- [x] **Step 1: Update prompt builder**
  Add `premadeQuestions?: Array<{ text: string; type: string; sectionName?: string }>` parameter to `buildGeneratorPrompt` and include explicit instructions directing the AI to include these and generate complementary questions.
- [x] **Step 2: Update `/api/ai/generate` route**
  Accept `premadeQuestions` in request body and forward to `buildGeneratorPrompt`. In final JSON parse, merge premade questions if the AI missed any.
- [x] **Step 3: Run unit tests**
  Verify prompt construction with tests.

---

### Task 4: Questions Tab UI (`/questions`)

**Files:**
- Modify: `src/app/(dashboard)/questions/page.tsx`
- Create: `src/components/questions/section-bank-view.tsx`
- Create: `src/components/questions/question-bank-dialog.tsx`

- [x] **Step 1: Build `QuestionBankDialog`**
  Modal to add/edit a premade question (text, type, description, options, starter code, section assignment).
- [x] **Step 2: Build `SectionBankView`**
  Create collapsible round cards (Screening, Technical, HR, Custom) with:
  - Section header, round icon, question count, and master toggle switch.
  - Item list with type badges, prompt preview, reorder, edit, delete, and enable/disable toggle.
  - "+ Add Question" button per section and "+ Add New Section" button.
- [x] **Step 3: Integrate into `QuestionsPage`**
  Add top tab switcher: `[ Section Presets (Screening, Technical, HR) | All Questions ]`.

---

### Task 5: New Interview & AI Generator Integration

**Files:**
- Modify: `src/components/interview/ai-generator.tsx`
- Modify: `src/app/(dashboard)/interviews/new/page.tsx`
- Modify: `src/components/interview/question-builder.tsx`

- [x] **Step 1: Add Premade Section selector in `ai-generator.tsx`**
  Fetch enabled bank questions, display master toggle `Include Premade Questions` with section chips (`Screening`, `Technical`, `HR`). Pass selected questions to `/api/ai/generate`.
- [x] **Step 2: Add Premade Questions import to manual interview creation in `page.tsx`**
  Allow instant one-click inclusion of enabled bank questions into manual interview drafts.
- [x] **Step 3: Verify question ordering and badges**
  Ensure premade questions render with a "Premade" badge and proper section grouping.

---

### Task 6: Final Verification & Evidence

**Files:**
- All modified files

- [x] **Step 1: Typecheck**
  Run `npx tsc --noEmit` and confirm 0 errors.
- [x] **Step 2: Test Suite**
  Run `npm run test:web` and confirm all tests pass.
- [x] **Step 3: Dev Server Check**
  Verify `http://localhost:3000/questions` and `http://localhost:3000/interviews/new` respond HTTP 200.
