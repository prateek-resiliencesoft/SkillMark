-- Stripe billing columns on organizations.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" text;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" text;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS "billingEmail" text;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_customer_uidx
  ON public.organizations ("stripeCustomerId")
  WHERE "stripeCustomerId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_subscription_uidx
  ON public.organizations ("stripeSubscriptionId")
  WHERE "stripeSubscriptionId" IS NOT NULL;
