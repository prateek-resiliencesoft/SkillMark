/**
 * Server-side database client (replaces the Supabase service-role client).
 *
 * Skillmark talks to plain Postgres through PostgREST (docker-compose service
 * "rest", bound to 127.0.0.1). The PostgREST query builder keeps every existing
 * `.from().select().eq()` call working unchanged. Server-only: never import in
 * client components.
 *
 * The export keeps the old name `supabaseAdmin` so existing imports still work.
 */
import { PostgrestClient } from "@supabase/postgrest-js";
import { storage } from "@/lib/storage";
import { deleteUser, getUserFromToken } from "@/lib/users";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

async function fetchWithRetry(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
    }
  }
  throw lastError;
}

export const POSTGREST_URL =
  process.env.POSTGREST_URL || `http://127.0.0.1:${process.env.POSTGREST_PORT || 3001}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = new PostgrestClient<any>(POSTGREST_URL, { fetch: fetchWithRetry });

/** Same client, `auth` schema (auth.users). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authDb: any = new PostgrestClient(POSTGREST_URL, { fetch: fetchWithRetry, schema: "auth" } as any);

export const supabaseAdmin = {
  from: db.from.bind(db),
  rpc: db.rpc.bind(db),
  schema: db.schema.bind(db),
  storage,
  auth: {
    getUser: async (token?: string) => {
      const user = await getUserFromToken(token);
      return { data: { user }, error: user ? null : { message: "Invalid session" } };
    },
    admin: {
      deleteUser: async (id: string) => {
        await deleteUser(id);
        return { data: null, error: null as { message: string } | null };
      },
    },
  },
};
