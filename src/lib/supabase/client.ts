"use client";

/**
 * Browser auth client (replaces supabase-js in the browser).
 * Talks to Skillmark's own /api/auth/* routes; the session is an httpOnly cookie.
 * Keeps the small subset of the old API the UI used.
 */
export interface AuthUser {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
  created_at?: string;
}
type AuthError = { message: string } | null;
type Listener = (event: string, session: { user: AuthUser } | null) => void;

const listeners = new Set<Listener>();
function emit(event: string, user: AuthUser | null) {
  listeners.forEach((l) => l(event, user ? { user } : null));
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

const client = {
  auth: {
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const { ok, json } = await post("/api/auth/login", { email, password });
      if (!ok) return { data: { user: null, session: null }, error: { message: json.error || "Invalid login credentials" } as AuthError };
      emit("SIGNED_IN", json.user);
      return { data: { user: json.user as AuthUser, session: { user: json.user } }, error: null as AuthError };
    },
    async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, unknown> } }) {
      const { ok, json } = await post("/api/auth/register", { email, password, data: options?.data ?? {} });
      if (!ok) return { data: { user: null, session: null }, error: { message: json.error || "Registration failed" } as AuthError };
      emit("SIGNED_IN", json.user);
      return { data: { user: { ...json.user, identities: [{}] }, session: { user: json.user } }, error: null as AuthError };
    },
    // Kept for call-site compatibility with the old Supabase API; scope is ignored.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async signOut(_opts?: { scope?: string }) {
      await post("/api/auth/logout", {});
      emit("SIGNED_OUT", null);
      return { error: null as AuthError };
    },
    async getUser() {
      const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      return { data: { user: (json.user as AuthUser) ?? null }, error: null as AuthError };
    },
    onAuthStateChange(cb: Listener) {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => { listeners.delete(cb); } } } };
    },
  },
};

export function createClient() {
  return client;
}
