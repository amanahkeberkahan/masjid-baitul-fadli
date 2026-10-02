/**
 * Migrasi data satu kali dari Firestore (Firebase) ke Supabase.
 *
 * Jalankan dari komputer dengan akses internet normal (BUKAN dari sandbox
 * Claude Code — domain Firebase/Supabase diblokir di sana):
 *
 *   pnpm exec tsx scripts/migrate-to-supabase.ts
 *
 * Perlu env var (bisa taruh di .env.local, script ini membacanya manual):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (rahasia — bypass RLS, hanya dipakai lokal)
 *   FIREBASE_ADMIN_EMAIL        (email akun pengurus Firebase yang aktif)
 *   FIREBASE_ADMIN_PASSWORD     (passwordnya)
 *
 * Script ini:
 * 1. Login ke Firebase sebagai pengurus yang sudah ada (supaya bisa baca
 *    semua koleksi sesuai Firestore Rules yang berlaku).
 * 2. Baca semua koleksi: transactions, programs, events, members,
 *    orgStructure, admins, financeCategories, memberCategories,
 *    cashAccounts, settings/donation, publicStats/finance, supporters.
 * 3. Tulis ke Supabase lewat service_role key (upsert pakai legacy_id =
 *    Firestore doc ID, jadi AMAN dijalankan ulang / idempotent).
 * 4. Untuk setiap akun pengurus Firebase, buat akun Supabase Auth baru
 *    dengan password SEMENTARA acak (karena password Firebase tidak bisa
 *    diekspor) — dicetak di akhir, WAJIB disampaikan ke pengurus terkait
 *    supaya mereka ganti password setelah login pertama.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, getFirestore, doc, getDoc } from "firebase/firestore";

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const content = raw.replace(/^﻿/, ""); // buang BOM kalau file disimpan dari Notepad
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  } catch {
    // .env.local opsional — bisa juga export env var langsung di shell.
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const FIREBASE_ADMIN_EMAIL = process.env.FIREBASE_ADMIN_EMAIL ?? "";
const FIREBASE_ADMIN_PASSWORD = process.env.FIREBASE_ADMIN_PASSWORD ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Isi NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.local dulu.");
  process.exit(1);
}
if (!FIREBASE_ADMIN_EMAIL || !FIREBASE_ADMIN_PASSWORD) {
  console.error("Isi FIREBASE_ADMIN_EMAIL dan FIREBASE_ADMIN_PASSWORD (akun pengurus Firebase yang masih aktif) di .env.local dulu.");
  process.exit(1);
}

// Config publik Firebase (sama seperti yang dulu ada di lib/firebase.ts).
const firebaseConfig = {
  apiKey: "AIzaSyBKPzlo37UAsE38dZZquBxPjnx6vSWFtbA",
  authDomain: "masjid-baitul-fadli.firebaseapp.com",
  projectId: "masjid-baitul-fadli",
  storageBucket: "masjid-baitul-fadli.firebasestorage.app",
  messagingSenderId: "423043019841",
  appId: "1:423043019841:web:448fa1b2a7b35a9ef742c0",
};

const firebaseApp = initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

function randomPassword() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase() + "!1";
}

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}
function toIso(value: unknown): string | null {
  const millis = toMillis(value);
  return millis ? new Date(millis).toISOString() : null;
}

async function migrateCollection(firestoreCollection: string, table: string, mapRow: (id: string, data: Record<string, unknown>) => Record<string, unknown>) {
  const snapshot = await getDocs(collection(firestore, firestoreCollection));
  const rows = snapshot.docs.map((item) => mapRow(item.id, item.data()));
  if (!rows.length) { console.log(`  ${firestoreCollection} -> ${table}: 0 baris, dilewati.`); return 0; }
  for (let start = 0; start < rows.length; start += 400) {
    const chunk = rows.slice(start, start + 400);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: "legacy_id" });
    if (error) throw new Error(`Gagal upsert ke ${table}: ${error.message}`);
  }
  console.log(`  ${firestoreCollection} -> ${table}: ${rows.length} baris.`);
  return rows.length;
}

async function migrateAdmins() {
  const snapshot = await getDocs(collection(firestore, "admins"));
  const credentials: Array<{ email: string; password: string }> = [];
  for (const item of snapshot.docs) {
    const data = item.data();
    const email = String(data.email ?? "");
    if (!email) continue;
    const { data: existing } = await supabase.from("admins").select("id").eq("legacy_id", item.id).maybeSingle();
    if (existing) { console.log(`  admins: ${email} sudah ada (dilewati).`); continue; }
    const password = randomPassword();
    const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) { console.log(`  admins: GAGAL buat akun ${email}: ${createError?.message}`); continue; }
    const { error: insertError } = await supabase.from("admins").insert({
      id: created.user.id, legacy_id: item.id, email, active: data.active === true,
      role: String(data.role ?? "pengurus"), created_at: toIso(data.createdAt),
    });
    if (insertError) { console.log(`  admins: akun ${email} dibuat tapi gagal insert row: ${insertError.message}`); continue; }
    credentials.push({ email, password });
    console.log(`  admins: ${email} dimigrasikan.`);
  }
  return credentials;
}

async function migrateSingleton(docPath: [string, string], table: string, key: string, mapRow: (data: Record<string, unknown>) => Record<string, unknown>) {
  const snapshot = await getDoc(doc(firestore, docPath[0], docPath[1]));
  if (!snapshot.exists()) { console.log(`  ${docPath.join("/")} -> ${table}: tidak ada, dilewati.`); return; }
  const { error } = await supabase.from(table).upsert({ key, ...mapRow(snapshot.data()) });
  if (error) throw new Error(`Gagal upsert ${table}: ${error.message}`);
  console.log(`  ${docPath.join("/")} -> ${table}: berhasil.`);
}

async function main() {
  console.log("Login ke Firebase sebagai", FIREBASE_ADMIN_EMAIL, "...");
  await signInWithEmailAndPassword(firebaseAuth, FIREBASE_ADMIN_EMAIL, FIREBASE_ADMIN_PASSWORD);
  console.log("Login berhasil.\n");

  console.log("Migrasi akun pengurus (admins)...");
  const credentials = await migrateAdmins();

  console.log("\nMigrasi data transaksi, jamaah, dll...");
  await migrateCollection("transactions", "transactions", (id, data) => ({
    legacy_id: id, title: String(data.title ?? ""), date: String(data.date ?? ""), amount: Number(data.amount ?? 0),
    type: String(data.type ?? ""), category: String(data.category ?? ""), details: String(data.details ?? ""),
    kas: String(data.kas ?? ""), created_at: toIso(data.createdAt), updated_at: toIso(data.updatedAt),
  }));
  await migrateCollection("programs", "programs", (id, data) => ({
    legacy_id: id, title: String(data.title ?? ""), amount: Number(data.amount ?? 0), target: Number(data.target ?? 0),
    category: String(data.category ?? ""), details: String(data.details ?? ""), created_at: toIso(data.createdAt),
  }));
  await migrateCollection("events", "events", (id, data) => ({
    legacy_id: id, title: String(data.title ?? ""), date: String(data.date ?? "") || null, category: String(data.category ?? ""),
    details: String(data.details ?? ""), image_url: String(data.imageUrl ?? ""), created_at: toIso(data.createdAt), updated_at: toIso(data.updatedAt),
  }));
  await migrateCollection("members", "members", (id, data) => ({
    legacy_id: id, title: String(data.title ?? ""), phone: String(data.phone ?? ""), address: String(data.address ?? ""),
    type: String(data.type ?? ""), category: String(data.category ?? ""), created_at: toIso(data.createdAt),
  }));
  await migrateCollection("orgStructure", "org_structure", (id, data) => ({
    legacy_id: id, title: String(data.title ?? ""), category: String(data.category ?? ""), phone: String(data.phone ?? ""),
    created_at: toIso(data.createdAt),
  }));
  await migrateCollection("financeCategories", "finance_categories", (id, data) => ({
    legacy_id: id, name: String(data.name ?? ""), type: String(data.type ?? ""),
  }));
  await migrateCollection("memberCategories", "member_categories", (id, data) => ({
    legacy_id: id, name: String(data.name ?? ""),
  }));
  await migrateCollection("cashAccounts", "cash_accounts", (id, data) => ({
    legacy_id: id, name: String(data.name ?? ""),
  }));
  await migrateCollection("supporters", "supporters", (id, data) => ({
    legacy_id: id, name: String(data.name ?? ""), phone: String(data.phone ?? ""), address: String(data.address ?? ""),
    amount: Number(data.amount ?? 0), frequency: String(data.frequency ?? ""), status: String(data.status ?? "baru"),
    created_at: toIso(data.createdAt),
  }));

  console.log("\nMigrasi pengaturan donasi & ringkasan saldo publik...");
  await migrateSingleton(["settings", "donation"], "settings", "donation", (data) => ({
    bank_name: String(data.bankName ?? ""), account_number: String(data.accountNumber ?? ""),
    account_holder: String(data.accountHolder ?? ""), qris_url: String(data.qrisUrl ?? ""),
  }));
  await migrateSingleton(["publicStats", "finance"], "public_stats", "finance", (data) => ({
    income: Number(data.income ?? 0), expense: Number(data.expense ?? 0), balance: Number(data.balance ?? 0),
    opening_balance: Number(data.openingBalance ?? 0), period_income: Number(data.periodIncome ?? 0),
    period_expense: Number(data.periodExpense ?? 0), period: String(data.period ?? ""),
    transaction_count: Number(data.transactionCount ?? 0), updated_through: String(data.updatedThrough ?? ""),
  }));

  console.log("\n=== SELESAI ===");
  if (credentials.length) {
    console.log("\nAkun pengurus baru di Supabase (password sementara, WAJIB diganti setelah login):");
    for (const credential of credentials) console.log(`  ${credential.email}  ->  ${credential.password}`);
  } else {
    console.log("\nTidak ada akun pengurus baru yang dibuat (mungkin sudah pernah dimigrasikan sebelumnya).");
  }
  process.exit(0);
}

main().catch((caught) => {
  console.error("\nMigrasi GAGAL:", caught instanceof Error ? caught.message : caught);
  process.exit(1);
});
