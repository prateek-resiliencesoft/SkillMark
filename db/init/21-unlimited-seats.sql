-- Member seats are unlimited on FREE/PRO (no invite cap).
-- Safe to re-run.

UPDATE public.platform_settings
SET
  value = jsonb_set(
    jsonb_set(value, '{FREE,seats}', 'null'::jsonb, true),
    '{PRO,seats}',
    'null'::jsonb,
    true
  ),
  "updatedAt" = now()
WHERE key = 'planLimits';

-- Drop stale per-org seat overrides so plan defaults apply.
UPDATE public.organizations
SET limits = limits - 'seats'
WHERE limits ? 'seats';
