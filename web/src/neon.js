// One shared Neon client: Neon Auth (Better Auth) + Data API (PostgREST).
// Reads use client.from(...) (RLS-filtered); writes use client.rpc(...) only.
import { createClient } from '@neon/neon-js';

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
const dataUrl = import.meta.env.VITE_NEON_DATA_API_URL;
if (!authUrl || !dataUrl) throw new Error('VITE_NEON_AUTH_URL / VITE_NEON_DATA_API_URL belum ditetapkan (lihat web/.env.example).');

export const client = createClient({ auth: { url: authUrl }, dataApi: { url: dataUrl } });
export const auth = client.auth;

// Better Auth returns { data, error }; normalise to the session user or null.
export async function currentUser() {
  const res = await auth.getSession();
  const d = res?.data ?? res;
  return d?.user ?? d?.session?.user ?? null;
}

// Throws an Error carrying the Postgres error code so pages can show a BM message.
export async function rpc(name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw Object.assign(new Error(error.message), { code: error.code, detail: error.details });
  return data;
}

export async function select(table, columns, build = q => q) {
  const { data, error } = await build(client.from(table).select(columns));
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data ?? [];
}
