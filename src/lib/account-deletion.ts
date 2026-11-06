/**
 * Account deletion = scrub + archive, never a hard delete.
 *
 * Why: interviews.userId / projects.createdBy are NOT NULL foreign keys to
 * auth.users with no cascade, so a hard delete is blocked (and was silently
 * ignored, letting people log straight back in). Instead we:
 *   1. archive a snapshot in public.deleted_accounts (kept for future use),
 *   2. soft-delete organizations the person owns (data retained, status DELETED),
 *   3. drop memberships, API keys and webhooks (access + credentials),
 *   4. scrub the auth row (email, password, metadata) and the profile.
 * The remaining uuid is an opaque anchor with no personal data.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scrubUser } from "@/lib/users";
import { nanoid } from "@/lib/id";
import { createLogger } from "@/lib/logger";

const log = createLogger("account-deletion");

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function deleteAccount(
  userId: string,
  opts: { deletedBy?: string | null } = {},
): Promise<DeleteAccountResult> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, email, name, role, createdAt")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return { ok: false, status: 404, error: "Account not found." };

  const email = String(profile.email);
  if (email.endsWith("@deleted.invalid")) return { ok: false, status: 409, error: "Account is already deleted." };

  if (profile.role === "ADMIN") {
    const { count } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "ADMIN");
    if ((count ?? 0) <= 1) {
      return { ok: false, status: 409, error: "Cannot delete the last platform admin." };
    }
  }

  const [{ data: owned }, { data: memberships }, { count: interviewCount }] = await Promise.all([
    supabaseAdmin.from("organizations").select("id, name, slug, plan, status").eq("ownerId", userId),
    supabaseAdmin.from("organization_members").select("organizationId, role").eq("userId", userId),
    supabaseAdmin.from("interviews").select("id", { count: "exact", head: true }).eq("userId", userId),
  ]);

  const { error: archiveError } = await supabaseAdmin.from("deleted_accounts").insert({
    userId,
    email,
    name: profile.name ?? null,
    platformRole: profile.role,
    signedUpAt: profile.createdAt,
    deletedBy: opts.deletedBy ?? null,
    deletedByLabel: opts.deletedBy && opts.deletedBy !== userId ? "platform_admin" : "self",
    organizations: (owned ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      plan: o.plan,
      relation: "owner",
    })),
    stats: { interviews: interviewCount ?? 0, memberships: memberships?.length ?? 0 },
  });
  if (archiveError) log.error("archive failed:", archiveError.message);
  if (archiveError) return { ok: false, status: 500, error: "Could not archive account." };

  // Retain org data but take owned orgs out of service (same shape as platform soft delete).
  for (const org of owned ?? []) {
    if (org.status === "DELETED") continue;
    await supabaseAdmin
      .from("organizations")
      .update({ status: "DELETED", slug: `deleted-${String(org.id).slice(0, 8)}-${nanoid(4)}` })
      .eq("id", org.id);
  }

  await Promise.all([
    supabaseAdmin.from("organization_members").delete().eq("userId", userId),
    supabaseAdmin.from("api_keys").delete().eq("userId", userId),
    supabaseAdmin.from("webhooks").delete().eq("userId", userId),
  ]);

  await supabaseAdmin
    .from("profiles")
    .update({
      email: `deleted+${userId}@deleted.invalid`,
      name: null,
      avatar: null,
      organization: null,
      role: "USER",
    })
    .eq("id", userId);

  const { error } = await scrubUser(userId);
  if (error) log.error("scrub failed:", error);
  if (error) return { ok: false, status: 500, error: "Could not remove account credentials." };
  return { ok: true };
}
