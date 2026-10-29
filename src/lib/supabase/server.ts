/**
 * Request-scoped server client (replaces @supabase/ssr createServerClient).
 * Reads the Skillmark session cookie; DB calls go through the server DB client.
 */
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { getUserFromToken, updatePassword } from "@/lib/users";

export function createClient() {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return {
    from: supabaseAdmin.from,
    rpc: supabaseAdmin.rpc,
    storage: supabaseAdmin.storage,
    auth: {
      async getUser(bearer?: string) {
        const user = await getUserFromToken(bearer ?? token);
        return { data: { user }, error: user ? null : { message: "Not authenticated" } };
      },
      async updateUser({ password }: { password?: string }) {
        const user = await getUserFromToken(token);
        if (!user) return { data: { user: null }, error: { message: "Not authenticated" } };
        if (password) {
          const { error } = await updatePassword(user.id, password);
          if (error) return { data: { user: null }, error: { message: error } };
        }
        return { data: { user }, error: null };
      },
    },
  };
}
