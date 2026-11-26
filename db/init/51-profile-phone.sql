-- ────────────────────────────────────────────────────────────
-- 51-profile-phone.sql: WhatsApp/contact phone on profiles.
-- Used for completion alerts (prefill from member signup number)
-- and left as the member's default contact. NULL = not set.
--
-- Also copies phone from signup metadata (raw_user_meta_data.phone)
-- into the new profile row.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, avatar, phone)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    NULLIF(trim(NEW.raw_user_meta_data->>'phone'), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    name   = coalesce(excluded.name, profiles.name),
    avatar = coalesce(excluded.avatar, profiles.avatar),
    phone  = coalesce(excluded.phone, profiles.phone);

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
