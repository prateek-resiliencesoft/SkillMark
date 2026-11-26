-- 10-rename-member-org-id.sql renamed organization_members."workspaceId" → "organizationId"
-- but the signup trigger still inserted "workspaceId", so every new signup failed.
-- Same behavior as before, correct column. Safe to re-run.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

DECLARE
  org_id  uuid;
  proj_id uuid;
BEGIN
  INSERT INTO public.profiles (id, email, name, avatar)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    name   = coalesce(excluded.name, profiles.name),
    avatar = coalesce(excluded.avatar, profiles.avatar);

  org_id  := gen_random_uuid();
  proj_id := gen_random_uuid();

  INSERT INTO public.organizations (id, name, slug, "ownerId")
  VALUES (org_id, 'Personal', 'personal-' || NEW.id::text, NEW.id)
  ON CONFLICT (slug) DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.organization_members ("organizationId", "userId", role)
    VALUES (org_id, NEW.id, 'OWNER');

    INSERT INTO public.projects (id, "organizationId", name, "createdBy")
    VALUES (proj_id, org_id, 'Default', NEW.id);
  END IF;

  RETURN NEW;
END;

$$;

NOTIFY pgrst, 'reload schema';
