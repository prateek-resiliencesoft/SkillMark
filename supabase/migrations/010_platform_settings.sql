-- Instance-wide settings edited from /admin/config.
-- Mirrors db/init/12-platform-settings.sql

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedBy" uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.platform_settings IS
  'Platform control-center settings (plan defaults, caps, feature defaults).';

INSERT INTO public.platform_settings (key, value)
VALUES
  (
    'instance',
    jsonb_build_object(
      'maxOrgsPerAccount', 10,
      'allowOrgSelfDelete', true,
      'allowOrgSelfServeBilling', true
    )
  ),
  (
    'planLimits',
    jsonb_build_object(
      'FREE', jsonb_build_object('seats', 5, 'interviews', 20, 'projects', 3),
      'PRO', jsonb_build_object('seats', 25, 'interviews', 200, 'projects', 20),
      'ENTERPRISE', jsonb_build_object('seats', null, 'interviews', null, 'projects', null),
      'SELF_HOSTED', jsonb_build_object('seats', null, 'interviews', null, 'projects', null)
    )
  ),
  (
    'defaultFeatureFlags',
    jsonb_build_object(
      'aiSettings', true,
      'integrations', true,
      'voiceInterviews', true,
      'publicForms', true,
      'usageDashboard', true
    )
  )
ON CONFLICT (key) DO NOTHING;
