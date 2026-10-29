# Section-Based Question Bank & AI Complementary Generation Specification

**Date**: 2026-10-27  
**Status**: Approved  
**Author**: Antigravity  

---

## 1. Executive Summary

Skillmark recruiters need to establish standardized, reusable questions organized into interview stages/rounds:
- **Screening Round** (e.g. background check, communication, salary expectations, timeline)
- **Technical Round** (e.g. coding challenge, architecture principles, problem solving)
- **HR Round** (e.g. culture fit, collaboration, conflict resolution, work preferences)

This feature introduces a **Section-Based Question Bank** where recruiters can create, configure, and toggle premade questions per section. When creating new interviews—either manually or using the **AI Generator**—the platform automatically pulls these premade questions and prompts the AI to generate **complementary role-specific questions** without duplicating the standard ones.

---

## 2. Architecture & Database Design

### 2.1 Database Schema (PostgreSQL)

Two dedicated relational tables scoped to the organization:

```sql
-- 1. Question Bank Sections (Rounds)
CREATE TABLE IF NOT EXISTS public.question_bank_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  "order"         integer NOT NULL DEFAULT 0,
  "isEnabled"     boolean NOT NULL DEFAULT true,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qb_sections_org ON public.question_bank_sections ("organizationId");

-- 2. Question Bank Items (Premade Questions)
CREATE TABLE IF NOT EXISTS public.question_bank_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sectionId"     uuid NOT NULL REFERENCES public.question_bank_sections(id) ON DELETE CASCADE,
  "organizationId" uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  text            text NOT NULL,
  description     text,
  type            text NOT NULL DEFAULT 'OPEN_ENDED',
  options         jsonb,
  "starterCode"   jsonb,
  "followUpPrompts" jsonb,
  "order"         integer NOT NULL DEFAULT 0,
  "isEnabled"     boolean NOT NULL DEFAULT true,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qb_items_section ON public.question_bank_items ("sectionId");
CREATE INDEX IF NOT EXISTS idx_qb_items_org ON public.question_bank_items ("organizationId");
```

### 2.2 Default Seed Data
When an organization opens the Question Bank for the first time, if no sections exist, the backend automatically provisions:
1. **Screening Round**:
   - *"Please introduce yourself and highlight your most recent relevant experience."* (OPEN_ENDED)
   - *"What is your current notice period and timeline for joining?"* (OPEN_ENDED)
2. **Technical Round**:
   - *"Walk through an end-to-end technical project you designed from scratch. What trade-offs did you make?"* (OPEN_ENDED)
   - *"Explain how you handle performance bottlenecks and debugging in production environments."* (OPEN_ENDED)
3. **HR Round**:
   - *"Describe a situation where you had a disagreement with a team member or stakeholder. How was it resolved?"* (OPEN_ENDED)
   - *"What type of team culture and work environment allows you to do your best work?"* (OPEN_ENDED)

---

## 3. Backend & API Services

### 3.1 tRPC Router: `questionBank`
Path: `src/server/routers/question-bank.ts`
- `list`: Fetches all sections with their items for the active organization, ordered by `order ASC`.
- `createSection`: Adds a new round/section.
- `updateSection`: Edits section title, description, or toggles `isEnabled`.
- `deleteSection`: Deletes a section and cascades to its items.
- `createItem`: Adds a question to a section.
- `updateItem`: Edits question text, type, options, starter code, or order.
- `toggleItem`: Fast toggle for question inclusion.
- `deleteItem`: Deletes a question.
- `getEnabledQuestions`: Returns all active items grouped by active sections for consumption by the interview creator and AI generator.

### 3.2 AI Generator Integration
- Path: `src/app/api/ai/generate/route.ts` & `src/lib/ai/prompts/generator.ts`
- Accepts an array of `premadeQuestions`:
  ```ts
  interface PremadeQuestionInput {
    id: string;
    text: string;
    type: string;
    sectionName: string;
    description?: string;
  }
  ```
- **Prompt Instruction**:
  The system prompt informs the AI model:
  > "MANDATORY PREMADE QUESTIONS: The following standardized questions have already been designated for this interview:
  > [List of premade questions with their round name]
  > DO NOT duplicate or re-ask these exact topics. Instead, generate complementary questions that evaluate other specific technical and job-specific criteria required for the role."
- **Response Composition**:
  The resulting interview merges the premade questions in their proper section order with the AI-generated complementary questions.

---

## 4. Frontend & User Interface

### 4.1 Questions Tab (`/questions`)
- Header switcher:
  - **Section Presets (Screening, Technical, HR)** [Default]
  - **All Interview Questions** (the existing table view of past questions)
- In the **Section Presets** view:
  - Responsive cards for each round with color-coded round icons (Screening: Blue, Technical: Violet, HR: Emerald).
  - Quick action toolbar: **+ Add Section**, **+ Add Question to Round**.
  - Interactive switches:
    - Section-level master switch: *Include this round in all interviews*
    - Item-level switch: *Active / Include*
  - Modal dialog to create/edit questions with support for `OPEN_ENDED`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, and `CODING`.

### 4.2 Interview Builder & AI Generator
- Location: `/interviews/new` & `AIGenerator` modal
- Dedicated control widget:
  - Master toggle: **Include Premade Section Questions** (default enabled).
  - Section checkboxes with count pills:
    - `☑ Screening Round (2)`
    - `☑ Technical Round (2)`
    - `☑ HR Round (2)`
  - Direct import button when manually assembling questions in `question-builder.tsx`.

---

## 5. Verification Plan

1. **Database Migration**:
   - Apply schema to Supabase container `supabase_db_aural`.
   - Verify table creation and foreign key constraints.
2. **tRPC Router Tests**:
   - Test CRUD operations on sections and items.
   - Verify organization isolation.
3. **AI Generation Testing**:
   - Verify API call with premade questions includes them without duplication.
4. **End-to-End UI Verification**:
   - Visit `http://localhost:3000/questions`, toggle sections, add questions.
   - Create new interview via `/interviews/new`, verify premade questions appear in preview and created interview.
5. **Regression Verification**:
   - Run `npx tsc --noEmit` and `npm run test:web`.
