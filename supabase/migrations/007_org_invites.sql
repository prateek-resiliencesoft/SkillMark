-- Pending organization invites. Mirrors db/init/09-org-invites.sql.

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email              text NOT NULL,
  role               "MemberRole" NOT NULL DEFAULT 'MEMBER',
  token              text NOT NULL UNIQUE,
  "invitedBy"        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  "expiresAt"        timestamptz NOT NULL,
  "acceptedAt"       timestamptz,
  "acceptedBy"       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_invites_pending_email_idx
  ON public.organization_invites ("organizationId", lower(email))
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS organization_invites_org_idx
  ON public.organization_invites ("organizationId", status);

CREATE INDEX IF NOT EXISTS organization_invites_token_idx
  ON public.organization_invites (token);

DO $$ BEGIN
  CREATE TRIGGER set_updated_at_organization_invites
    BEFORE UPDATE ON public.organization_invites
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
