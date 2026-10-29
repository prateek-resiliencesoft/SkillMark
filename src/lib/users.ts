/**
 * User accounts stored in auth.users (bcrypt password hashes).
 * A trigger (public.handle_new_user) creates the profile.
 * Organizations are created by the user during onboarding.
 */
import bcrypt from "bcryptjs";
import { authDb } from "@/lib/supabase/admin";
import { verifySession, type SessionUser } from "@/lib/auth-session";

type Row = { id: string; email: string; encrypted_password: string; raw_user_meta_data: Record<string, unknown> | null; created_at: string };

function toUser(r: Row): SessionUser {
  return { id: r.id, email: r.email, user_metadata: r.raw_user_meta_data ?? {}, created_at: r.created_at };
}

export async function findUserByEmail(email: string): Promise<Row | null> {
  const { data } = await authDb.from("users").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  return (data as Row) ?? null;
}

export async function getUserById(id: string): Promise<SessionUser | null> {
  const { data } = await authDb.from("users").select("*").eq("id", id).maybeSingle();
  return data ? toUser(data as Row) : null;
}

export async function verifyPassword(email: string, password: string): Promise<SessionUser | null> {
  const row = await findUserByEmail(email);
  if (!row?.encrypted_password) return null;
  const ok = await bcrypt.compare(password, row.encrypted_password);
  return ok ? toUser(row) : null;
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
  return { user: toUser(data as Row), error: null };
}

export async function updatePassword(id: string, password: string) {
  const hash = await bcrypt.hash(password, 10);
  const { error } = await authDb.from("users").update({ encrypted_password: hash, updated_at: new Date().toISOString() }).eq("id", id);
  return { error: error?.message ?? null };
}

export async function deleteUser(id: string) {
  await authDb.from("users").delete().eq("id", id);
}

/** Validate a session JWT and confirm the user still exists. */
export async function getUserFromToken(token?: string | null): Promise<SessionUser | null> {
  const s = await verifySession(token);
  if (!s) return null;
  return getUserById(s.id);
}
