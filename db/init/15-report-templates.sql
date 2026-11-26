-- Per-organization default PDF report template (branding, sections, format).
-- Validated in the app (src/lib/report-template.ts); logo is an inline data URL
-- capped at ~280 KB. Safe to re-run.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS "reportTemplate" jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.organizations
    ADD CONSTRAINT organizations_report_template_size
    CHECK (pg_column_size("reportTemplate") < 400000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
