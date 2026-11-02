-- Rename organization_members."workspaceId" → "organizationId".

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_members'
      AND column_name = 'workspaceId'
  ) THEN
    ALTER TABLE public.organization_members
      RENAME COLUMN "workspaceId" TO "organizationId";
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE "organizationId" = org_id
      AND "userId" = auth.uid()
  );
$$;

DROP FUNCTION IF EXISTS public.create_organization(text, text, uuid);

CREATE OR REPLACE FUNCTION public.create_organization(org_name text, org_slug text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_org     record;
  v_proj    record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO organizations (name, slug, "ownerId")
  VALUES (org_name, org_slug, v_user_id)
  RETURNING * INTO v_org;

  INSERT INTO organization_members ("organizationId", "userId", role)
  VALUES (v_org.id, v_user_id, 'OWNER');

  INSERT INTO projects ("organizationId", name, "createdBy")
  VALUES (v_org.id, 'Default', v_user_id)
  RETURNING * INTO v_proj;

  RETURN json_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'slug', v_org.slug,
    'ownerId', v_org."ownerId"
  );
END;
$$;
