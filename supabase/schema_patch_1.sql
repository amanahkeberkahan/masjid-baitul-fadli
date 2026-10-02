-- Patch setelah schema.sql: kolom tambahan untuk migrasi data dari Firestore
-- dan konsistensi updated_at/updated_by di semua tabel konten.
-- Aman dijalankan berkali-kali (pakai IF NOT EXISTS).
-- Supabase Dashboard -> SQL Editor -> New query -> Run

alter table transactions add column if not exists legacy_id text unique;
alter table programs add column if not exists legacy_id text unique;
alter table programs add column if not exists updated_at timestamptz;
alter table programs add column if not exists updated_by uuid references auth.users(id);
alter table events add column if not exists legacy_id text unique;
alter table members add column if not exists legacy_id text unique;
alter table members add column if not exists updated_at timestamptz;
alter table members add column if not exists updated_by uuid references auth.users(id);
alter table org_structure add column if not exists legacy_id text unique;
alter table org_structure add column if not exists updated_at timestamptz;
alter table org_structure add column if not exists updated_by uuid references auth.users(id);
alter table finance_categories add column if not exists legacy_id text unique;
alter table member_categories add column if not exists legacy_id text unique;
alter table cash_accounts add column if not exists legacy_id text unique;
alter table admins add column if not exists legacy_id text unique;
alter table supporters add column if not exists legacy_id text unique;
