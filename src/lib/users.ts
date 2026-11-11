/**
 * User accounts stored in auth.users (bcrypt password hashes).
 * A trigger (public.handle_new_user) creates the profile; ensureProfileRow
 * is a belt-and-suspenders upsert for invite-join / register paths.
 * Organizations are created by the user during onboarding.
 */
import bcrypt from "bcryptjs";
import { authDb, supabaseAdmin } from "@/lib/supabase/admin";
import { verifySession, type SessionUser } from "@/lib/auth-session";

type Row = {
  id: string;
  email: string;
  encrypted_password: string;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: string;
  paused_at?: string | null;
  deleted_at?: string | null;
};

function toUser(r: Row): SessionUser {
  return { id: r.id, email: r.email, user_metadata: r.raw_user_meta_data ?? {}, created_at: r.created_at };
}

export async function findUserByEmail(email: string): Promise<Row | null> {
  const { data } = await authDb.from("users").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  return (data as Row) ?? null;
}

/** Active = not paused and not deleted. Paused/deleted accounts cannot hold a session. */
export async function getUserById(id: string): Promise<SessionUser | null> {
  const { data } = await authDb.from("users").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as Row;
  if (row.deleted_at || row.paused_at) return null;
  return toUser(row);
}

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid" | "paused" };

export async function verifyLogin(email: string, password: string): Promise<LoginResult> {
  const row = await findUserByEmail(email);
  if (!row?.encrypted_password || row.deleted_at) return { ok: false, reason: "invalid" };
  const ok = await bcrypt.compare(password, row.encrypted_password);
  if (!ok) return { ok: false, reason: "invalid" };
  if (row.paused_at) return { ok: false, reason: "paused" };
  return { ok: true, user: toUser(row) };
}

export async function verifyPassword(email: string, password: string): Promise<SessionUser | null> {
  const r = await verifyLogin(email, password);
  return r.ok ? r.user : null;
}

export async function setUserPaused(id: string, paused: boolean): Promise<{ error: string | null }> {
  const { error } = await authDb
    .from("users")
    .update({ paused_at: paused ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  return { error: error?.message ?? null };
}

/**
 * Scrub credentials + identity but keep the row as an opaque FK anchor
 * (interviews/projects still reference it). Frees the email for re-registration.
 */
export async function scrubUser(id: string): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const { error } = await authDb
    .from("users")
    .update({
      email: `deleted+${id}@deleted.invalid`,
      // Not a valid bcrypt hash → bcrypt.compare can never succeed.
      encrypted_password: "!deleted",
      raw_user_meta_data: {},
      deleted_at: now,
      paused_at: null,
      updated_at: now,
    })
    .eq("id", id);
  return { error: error?.message ?? null };
}

/** Ensure profiles row exists (trigger may lag / miss under PostgREST). */
export async function ensureProfileRow(
  user: SessionUser,
  name?: string | null,
): Promise<void> {
  const trimmed =
    name?.trim() ||
    (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
    (typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "") ||
    null;

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    await supabaseAdmin.from("profiles").insert({
      id: user.id,
      email: user.email,
      name: trimmed,
    });
    return;
  }

  const patch: { email?: string; name?: string } = {};
  if (existing.email !== user.email) patch.email = user.email;
  if (!existing.name && trimmed) patch.name = trimmed;
  if (Object.keys(patch).length > 0) {
    await supabaseAdmin.from("profiles").update(patch).eq("id", user.id);
  }
}

export async function createUser(email: string, password: string, meta: Record<string, unknown> = {}) {
  const normalized = email.trim().toLowerCase();
  if (await findUserByEmail(normalized)) return { user: null, error: "User already registered" };
  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await authDb
    .from("users")
    .insert({ email: normalized, encrypted_password: hash, raw_user_meta_data: meta })
    .select("*")
    .single();
  if (error) return { user: null, error: error.message };
  const user = toUser(data as Row);
  await ensureProfileRow(user);
  return { user, error: null };
}

export async function updatePassword(id: string, password: string) {
  const hash = await bcrypt.hash(password, 10);
  const { error } = await authDb.from("users").update({ encrypted_password: hash, updated_at: new Date().toISOString() }).eq("id", id);
  return { error: error?.message ?? null };
}

/** Hard delete; returns the DB error (e.g. FK violation) instead of swallowing it. */
export async function deleteUser(id: string): Promise<{ error: string | null }> {
  const { error } = await authDb.from("users").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/** Validate a session JWT and confirm the user still exists. */
export async function getUserFromToken(token?: string | null): Promise<SessionUser | null> {
  const s = await verifySession(token);
  if (!s) return null;
  return getUserById(s.id);
}
