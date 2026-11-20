import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// createClient() melempar error bila URL kosong, dan modul ini ikut dievaluasi saat
// prerender. Di lingkungan tanpa env (mis. Vercel Preview yang belum diisi) build
// tetap lolos dengan alamat placeholder; aplikasi hanya gagal memuat data.
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum diatur; data tidak akan dimuat.");
}

export const supabase = createClient(supabaseUrl || "https://env-belum-diatur.supabase.co", supabaseAnonKey || "env-belum-diatur");
