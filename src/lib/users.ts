/**
 * User accounts stored in auth.users (bcrypt password hashes).
 * A trigger (public.handle_new_user) creates the profile; ensureProfileRow
 * is a belt-and-suspenders upsert for invite-join / register paths.
 * Organizations are created by the user during onboarding.
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { authDb, supabaseAdmin } from "@/lib/supabase/admin";
import { signSession, verifySession, type SessionUser } from "@/lib/auth-session";

type Row = {
  id: string;
  email: string;
  encrypted_password: string;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: string;
  paused_at?: string | null;
  deleted_at?: string | null;
  /** Migration 40-auth-token-version; absent on older databases. */
  token_version?: number | null;
};

/** Tombstone domain for scrubbed accounts; never registrable. */
export const DELETED_EMAIL_DOMAIN = "deleted.invalid";

/** RFC 2606 `.invalid` addresses (incl. account tombstones) cannot be registered. */
export function isReservedEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return domain === "invalid" || domain.endsWith(".invalid");
}

function toUser(r: Row): SessionUser {
  return { id: r.id, email: r.email, user_metadata: r.raw_user_meta_data ?? {}, created_at: r.created_at };
}

function tokenVersionOf(r: Pick<Row, "token_version">): number {
  return typeof r.token_version === "number" ? r.token_version : 0;
}

export async function findUserByEmail(email: string): Promise<Row | null> {
  const { data } = await authDb.from("users").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
  return (data as Row) ?? null;
}

async function getActiveRow(id: string): Promise<Row | null> {
  const { data } = await authDb.from("users").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as Row;
  if (row.deleted_at || row.paused_at) return null;
  return row;
}

/** Active = not paused and not deleted. Paused/deleted accounts cannot hold a session. */
export async function getUserById(id: string): Promise<SessionUser | null> {
  const row = await getActiveRow(id);
  return row ? toUser(row) : null;
}

/** Mint a session JWT bound to the user's current token_version. */
export async function issueSessionToken(user: SessionUser): Promise<string> {
  const { data } = await authDb.from("users").select("token_version").eq("id", user.id).maybeSingle();
  return signSession(user, data ? tokenVersionOf(data as Row) : 0);
}

/**
 * Invalidate every session JWT issued so far for this user (password change,
 * admin reset, "sign out everywhere", deletion). Returns the new version.
 */
export async function bumpTokenVersion(id: string): Promise<{ version: number | null; error: string | null }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error: readError } = await authDb.from("users").select("token_version").eq("id", id).maybeSingle();
    if (readError) return { version: null, error: readError.message };
    if (!data) return { version: null, error: "User not found" };
    const current = tokenVersionOf(data as Row);
    const { data: updated, error } = await authDb
      .from("users")
      .update({ token_version: current + 1, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("token_version", current)
      .select("token_version");
    if (error) return { version: null, error: error.message };
    if (Array.isArray(updated) && updated.length > 0) return { version: current + 1, error: null };
  }
  return { version: null, error: "Could not revoke sessions (concurrent update)" };
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

/** Random suffix so a pre-registered look-alike address can never block the scrub (UNIQUE email). */
export function tombstoneEmail(id: string): string {
  return `deleted+${id}.${randomBytes(6).toString("hex")}@${DELETED_EMAIL_DOMAIN}`;
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
      email: tombstoneEmail(id),
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
  const metaPhone =
    typeof user.user_metadata?.phone === "string" ? user.user_metadata.phone.trim() : "";

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, phone")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    await supabaseAdmin.from("profiles").insert({
      id: user.id,
      email: user.email,
      name: trimmed,
      ...(metaPhone ? { phone: metaPhone } : {}),
    });
    return;
  }

  const patch: { email?: string; name?: string; phone?: string } = {};
  if (existing.email !== user.email) patch.email = user.email;
  if (!existing.name && trimmed) patch.name = trimmed;
  if (!existing.phone && metaPhone) patch.phone = metaPhone;
  if (Object.keys(patch).length > 0) {
    await supabaseAdmin.from("profiles").update(patch).eq("id", user.id);
  }
}

export async function createUser(email: string, password: string, meta: Record<string, unknown> = {}) {
  const normalized = email.trim().toLowerCase();
  if (isReservedEmail(normalized)) return { user: null, error: "This email address can't be used" };
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

/** Sets the password and revokes every existing session in the same row update. */
export async function updatePassword(id: string, password: string): Promise<{ error: string | null; tokenVersion?: number }> {
  const hash = await bcrypt.hash(password, 10);
  const { data: current, error: readError } = await authDb.from("users").select("token_version").eq("id", id).maybeSingle();
  if (readError) return { error: readError.message };
  if (!current) return { error: "User not found" };
  const tokenVersion = tokenVersionOf(current as Row) + 1;
  const { error } = await authDb
    .from("users")
    .update({ encrypted_password: hash, token_version: tokenVersion, updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { error: error.message } : { error: null, tokenVersion };
}

/** Hard delete; returns the DB error (e.g. FK violation) instead of swallowing it. */
export async function deleteUser(id: string): Promise<{ error: string | null }> {
  const { error } = await authDb.from("users").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/** Validate a session JWT, confirm the user is still active and the token was not revoked. */
export async function getUserFromToken(token?: string | null): Promise<SessionUser | null> {
  const s = await verifySession(token);
  if (!s) return null;
  const row = await getActiveRow(s.id);
  if (!row || s.tokenVersion !== tokenVersionOf(row)) return null;
  return toUser(row);
}
