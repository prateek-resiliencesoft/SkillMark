/**
 * Invite join auth: one decision — sign in if email exists, else create account.
 * Keeps invite acceptance off the generic /login bounce.
 */
import type { SessionUser } from "@/lib/auth-session";
import type { LoginResult } from "@/lib/users";

export type InviteJoinAuth = {
  findUserByEmail: (email: string) => Promise<{ id: string } | null>;
  verifyLogin: (email: string, password: string) => Promise<LoginResult>;
  createUser: (
    email: string,
    password: string,
    meta?: Record<string, unknown>,
  ) => Promise<{ user: SessionUser | null; error: string | null }>;
};

export type InviteJoinAuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string; status: number };

export async function authenticateForInviteEmail(
  input: { email: string; password: string; name?: string },
  auth: InviteJoinAuth,
): Promise<InviteJoinAuthResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) {
    return { ok: false, error: "Email and password are required", status: 400 };
  }

  const existing = await auth.findUserByEmail(email);
  if (existing) {
    const result = await auth.verifyLogin(email, password);
    if (!result.ok) {
      if (result.reason === "paused") {
        return {
          ok: false,
          error: "This account is paused. Please contact support to restore access.",
          status: 403,
        };
      }
      return { ok: false, error: "Wrong password for this email.", status: 401 };
    }
    return { ok: true, user: result.user };
  }

  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters", status: 400 };
  }

  const meta: Record<string, unknown> = {};
  const name = input.name?.trim();
  if (name) meta.full_name = name;

  const { user, error } = await auth.createUser(email, password, meta);
  if (!user) {
    return { ok: false, error: error || "Could not create account", status: 400 };
  }
  return { ok: true, user };
}
