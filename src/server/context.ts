import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/auth";

export async function createContext() {
  let user = null;
  try {
    user = await getAuthUser();
  } catch {
    // Suppress auth errors (e.g., invalid cookies on public pages)
  }
  return {
    user,
    supabase: supabaseAdmin,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
