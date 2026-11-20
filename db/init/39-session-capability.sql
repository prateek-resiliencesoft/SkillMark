-- ────────────────────────────────────────────────────────────
-- 39-session-capability.sql: candidate session capability cookie enforcement.
--
-- Sessions created after this migration get "capabilityRequired" = true when the
-- server issues the signed per-session cookie (src/lib/session-capability.ts).
-- Candidate write/lifecycle routes and the voice relays then require that cookie,
-- so knowing a session UUID (e.g. from a ?sid= link) is no longer enough.
-- Sessions that existed before keep working until they end (default false).
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS "capabilityRequired" boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
