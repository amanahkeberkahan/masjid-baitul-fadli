import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses Row Level Security. Server-only: never
// import this file from a "use client" component or anything that ships
// to the browser bundle.
//
// Dibuat saat pertama dipakai (bukan saat modul di-import) supaya `next build`
// tidak gagal di lingkungan tanpa secret, mis. Vercel Preview yang env
// Supabase-nya belum diisi. Tanpa env, request ke API akan gagal dengan pesan jelas.
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diatur di environment server.");
  }
  client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
