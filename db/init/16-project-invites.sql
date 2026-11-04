-- Project-scoped invites: an organization invite can also grant access to one
-- project. On accept the user joins the org and is added to project_members.
-- Safe to re-run.

ALTER TABLE public.organization_invites
  ADD COLUMN IF NOT EXISTS "projectId" uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "projectRole" "MemberRole";

NOTIFY pgrst, 'reload schema';
