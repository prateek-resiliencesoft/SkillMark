-- ────────────────────────────────────────────────────────────
-- 40-auth-token-version.sql: server-side revocation for session JWTs.
--
-- Session JWTs carry the token_version they were minted under ("tv" claim);
-- getUserFromToken (src/lib/users.ts) rejects a token whose tv differs from
-- the row. Bumped on password change, admin password reset and
-- "sign out everywhere", which revokes every older session at once.
-- Tokens issued before this migration have no tv and count as version 0.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
