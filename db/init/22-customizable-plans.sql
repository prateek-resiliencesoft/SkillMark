-- Plans become free-form text so superadmin can add custom plan IDs.
-- Catalog lives in platform_settings.planCatalog (JSON). Safe to re-run.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'plan'
      AND udt_name = 'OrgPlan'
  ) THEN
    ALTER TABLE public.organizations
      ALTER COLUMN plan DROP DEFAULT;
    ALTER TABLE public.organizations
      ALTER COLUMN plan TYPE text USING plan::text;
    ALTER TABLE public.organizations
      ALTER COLUMN plan SET DEFAULT 'SELF_HOSTED';
  END IF;
END $$;

-- Seed editable catalog from current planLimits when missing.
INSERT INTO public.platform_settings (key, value)
VALUES (
  'planCatalog',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'FREE',
      'name', 'Free',
      'blurb', 'Try ResilienceSoft Interview with a small team.',
      'limits', jsonb_build_object('seats', null, 'interviews', 20, 'projects', 3),
      'purchaseable', false,
      'stripePriceId', null,
      'stripePriceEnv', null,
      'features', jsonb_build_object(
        'aiSettings', true,
        'integrations', true,
        'voiceInterviews', true,
        'publicForms', true,
        'usageDashboard', true
      )
    ),
    jsonb_build_object(
      'id', 'PRO',
      'name', 'Pro',
      'blurb', 'More people, more interviews, room to grow.',
      'limits', jsonb_build_object('seats', null, 'interviews', 200, 'projects', 20),
      'purchaseable', true,
      'stripePriceId', null,
      'stripePriceEnv', 'STRIPE_PRICE_PRO',
      'features', jsonb_build_object(
        'aiSettings', true,
        'integrations', true,
        'voiceInterviews', true,
        'publicForms', true,
        'usageDashboard', true
      )
    ),
    jsonb_build_object(
      'id', 'ENTERPRISE',
      'name', 'Enterprise',
      'blurb', 'Unlimited seats and interviews for larger teams.',
      'limits', jsonb_build_object('seats', null, 'interviews', null, 'projects', null),
      'purchaseable', true,
      'stripePriceId', null,
      'stripePriceEnv', 'STRIPE_PRICE_ENTERPRISE',
      'features', jsonb_build_object(
        'aiSettings', true,
        'integrations', true,
        'voiceInterviews', true,
        'publicForms', true,
        'usageDashboard', true
      )
    ),
    jsonb_build_object(
      'id', 'SELF_HOSTED',
      'name', 'Self-hosted',
      'blurb', 'Run on your own servers with no plan caps.',
      'limits', jsonb_build_object('seats', null, 'interviews', null, 'projects', null),
      'purchaseable', false,
      'stripePriceId', null,
      'stripePriceEnv', null,
      'features', jsonb_build_object(
        'aiSettings', true,
        'integrations', true,
        'voiceInterviews', true,
        'publicForms', true,
        'usageDashboard', true
      )
    )
  )
)
ON CONFLICT (key) DO NOTHING;
