-- ────────────────────────────────────────────────────────────
-- 004_question_bank.sql: Section-based Question Bank
-- ────────────────────────────────────────────────────────────

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
CREATE INDEX IF NOT EXISTS idx_qb_sections_order ON public.question_bank_sections ("organizationId", "order");

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
CREATE INDEX IF NOT EXISTS idx_qb_items_order ON public.question_bank_items ("sectionId", "order");
