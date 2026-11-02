-- Multi-tenant platform foundation:
--   • organization lifecycle (status / plan / limits / feature flags)
--   • platform audit log for super-admin actions
-- Safe to re-run (IF NOT EXISTS / DO blocks).
--
-- Promote a platform admin (one-time, via SQL):
--   UPDATE profiles SET role = 'ADMIN' WHERE email = 'you@example.com';

DO $$ BEGIN
  CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrgPlan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE', 'SELF_HOSTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status "OrgStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan "OrgPlan" NOT NULL DEFAULT 'SELF_HOSTED';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS "featureFlags" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS organizations_status_idx
  ON public.organizations (status);

CREATE INDEX IF NOT EXISTS organizations_plan_idx
  ON public.organizations (plan);

CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorId"    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  "targetType" text NOT NULL,
  "targetId"   text,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_audit_logs_created_idx
  ON public.platform_audit_logs ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS platform_audit_logs_actor_idx
  ON public.platform_audit_logs ("actorId");

NOTIFY pgrst, 'reload schema';
