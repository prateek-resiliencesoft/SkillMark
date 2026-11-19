-- ────────────────────────────────────────────────────────────
-- 36-error-log-signatures.sql: group interview errors for the superadmin
-- Error Logs page.
--  • session_error_logs.signature: stable id of the error group (category +
--    source + normalized message). Filled on write; older rows are filled by
--    scripts/backfill-error-signatures.ts.
--  • error_log_groups: acknowledge / resolve state per group.
--
-- Idempotent: safe to re-run on an existing database:
--   docker compose exec -T db psql -U skillmark -d skillmark < db/init/36-error-log-signatures.sql
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.session_error_logs
  ADD COLUMN IF NOT EXISTS signature text;

CREATE INDEX IF NOT EXISTS idx_session_error_logs_signature
  ON public.session_error_logs (signature, "createdAt");

CREATE TABLE IF NOT EXISTS public.error_log_groups (
  signature    text PRIMARY KEY,
  -- open | acknowledged | resolved
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'acknowledged', 'resolved')),
  note         text,
  "updatedBy"  uuid,
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz
);

GRANT ALL ON public.error_log_groups TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
