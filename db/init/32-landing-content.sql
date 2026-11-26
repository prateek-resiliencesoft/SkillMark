-- ────────────────────────────────────────────────────────────
-- 32-landing-content.sql: CMS draft, published versions and media
-- for the marketing site (Landing Page Controls in /admin/landing).
--
-- Idempotent: safe to re-run on an existing database:
--   npm run db:migrate
--   # or: docker compose exec -T db psql -U skillmark -d skillmark < db/init/32-landing-content.sql
-- Production /dev Deploy workflows run scripts/db-migrate.sh after compose up.
-- ────────────────────────────────────────────────────────────

-- Single-row draft the admin edits before publishing.
CREATE TABLE IF NOT EXISTS public.landing_draft (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedBy" uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.landing_draft IS
  'Working draft of the marketing site document (Landing Page Controls).';

-- Append-only publish history. Highest version is the live document.
CREATE TABLE IF NOT EXISTS public.landing_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version       integer NOT NULL,
  content       jsonb NOT NULL,
  note          text NOT NULL DEFAULT '',
  "publishedAt" timestamptz NOT NULL DEFAULT now(),
  "publishedBy" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "rebuildRunId" text,
  "rebuildStatus" text
);

CREATE UNIQUE INDEX IF NOT EXISTS landing_versions_version_key
  ON public.landing_versions (version);

CREATE INDEX IF NOT EXISTS landing_versions_published_idx
  ON public.landing_versions ("publishedAt" DESC);

COMMENT ON TABLE public.landing_versions IS
  'Published snapshots of the marketing site. Restore copies a row back into landing_draft.';

-- Uploaded images for the media library (bytes live in app storage).
CREATE TABLE IF NOT EXISTS public.landing_media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "storageKey" text NOT NULL,
  mime         text NOT NULL,
  size         integer NOT NULL CHECK (size > 0),
  width        integer,
  height       integer,
  alt          text NOT NULL DEFAULT '',
  "fileName"   text NOT NULL DEFAULT '',
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "createdBy"  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS landing_media_created_idx
  ON public.landing_media ("createdAt" DESC);

COMMENT ON TABLE public.landing_media IS
  'Metadata for images uploaded from Landing Page Controls.';

-- Latest rebuild attempt (so the admin can poll without scanning versions).
-- rebuildAfter: durable debounce — dispatch when now >= rebuildAfter.
-- claimExpiresAt: lease for an in-flight claim so abandoned claims can retry.
CREATE TABLE IF NOT EXISTS public.landing_rebuild (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  "runId"     text,
  status      text NOT NULL DEFAULT 'idle',
  "startedAt" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  detail      text,
  "rebuildAfter" timestamptz,
  "claimExpiresAt" timestamptz
);

ALTER TABLE public.landing_rebuild
  ADD COLUMN IF NOT EXISTS "rebuildAfter" timestamptz;

ALTER TABLE public.landing_rebuild
  ADD COLUMN IF NOT EXISTS "claimExpiresAt" timestamptz;

INSERT INTO public.landing_rebuild (id, status)
VALUES (1, 'idle')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.landing_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_rebuild ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.landing_draft TO service_role;
GRANT ALL ON public.landing_versions TO service_role;
GRANT ALL ON public.landing_media TO service_role;
GRANT ALL ON public.landing_rebuild TO service_role;

NOTIFY pgrst, 'reload schema';
