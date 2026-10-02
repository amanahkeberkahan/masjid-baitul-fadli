-- Skema database Masjid Baitul Fadli untuk Supabase
-- Jalankan file ini di: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Urutan di file ini penting (tabel admins dirujuk oleh RLS tabel lain).

-- =========================================================
-- 1. TABEL
-- =========================================================

-- Pengurus aktif. id = auth.users.id (1:1 dengan akun login Supabase Auth).
create table if not exists admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  active boolean not null default true,
  role text not null default 'pengurus', -- 'pengurus' (penuh) | 'staff' (hanya kegiatan)
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date not null,
  amount numeric not null default 0,
  type text not null, -- 'Pemasukan' | 'Pengeluaran'
  category text not null default '',
  details text not null default '',
  kas text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz,
  updated_by uuid references auth.users(id)
);

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  amount numeric not null default 0,
  target numeric not null default 0,
  category text not null default '',
  details text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date,
  category text not null default '',
  details text not null default '',
  image_url text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz,
  updated_by uuid references auth.users(id)
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  title text not null, -- nama jamaah
  phone text not null default '',
  address text not null default '',
  type text not null default '', -- 'Mukim' | 'Non-Mukim'
  category text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists org_structure (
  id uuid primary key default gen_random_uuid(),
  title text not null, -- nama orang
  category text not null default '', -- jabatan
  phone text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists finance_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default '', -- 'Pemasukan' | 'Pengeluaran'
  created_at timestamptz not null default now()
);

create table if not exists member_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists cash_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Pengaturan donasi (rekening + QRIS). Satu baris saja, key tetap 'donation'.
create table if not exists settings (
  key text primary key,
  bank_name text not null default '',
  account_number text not null default '',
  account_holder text not null default '',
  qris_url text not null default '',
  updated_at timestamptz
);

-- Ringkasan saldo publik (dibaca di Beranda tanpa login).
create table if not exists public_stats (
  key text primary key,
  income numeric not null default 0,
  expense numeric not null default 0,
  balance numeric not null default 0,
  opening_balance numeric not null default 0,
  period_income numeric not null default 0,
  period_expense numeric not null default 0,
  period text not null default '',
  transaction_count integer not null default 0,
  updated_through text not null default '',
  updated_at timestamptz
);

-- Form "Jadi Donatur Tetap" (publik, write-only dari sisi pengunjung).
create table if not exists supporters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  address text not null default '',
  amount numeric not null default 0,
  frequency text not null default '',
  status text not null default 'baru',
  created_at timestamptz not null default now()
);

-- =========================================================
-- 2. HELPER FUNCTIONS (dipakai RLS)
-- =========================================================

create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from admins where id = auth.uid() and active = true
  );
$$;

create or replace function is_full_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from admins where id = auth.uid() and active = true and role <> 'staff'
  );
$$;

-- =========================================================
-- 3. ROW LEVEL SECURITY
-- =========================================================

alter table admins enable row level security;
alter table transactions enable row level security;
alter table programs enable row level security;
alter table events enable row level security;
alter table members enable row level security;
alter table org_structure enable row level security;
alter table finance_categories enable row level security;
alter table member_categories enable row level security;
alter table cash_accounts enable row level security;
alter table settings enable row level security;
alter table public_stats enable row level security;
alter table supporters enable row level security;

-- admins: pengurus boleh baca semua, boleh baca punya sendiri; hanya pengurus
-- penuh yang boleh menulis (tambah/nonaktifkan akun pengurus lain).
create policy "admins_select" on admins for select
  using (auth.uid() = id or is_admin());
create policy "admins_write" on admins for all
  using (is_full_admin()) with check (is_full_admin());

-- transactions, members, org_structure, finance/member categories, cash
-- accounts: data sensitif, hanya pengurus penuh.
create policy "transactions_all" on transactions for all
  using (is_full_admin()) with check (is_full_admin());
create policy "members_all" on members for all
  using (is_full_admin()) with check (is_full_admin());
create policy "org_structure_all" on org_structure for all
  using (is_full_admin()) with check (is_full_admin());
create policy "finance_categories_all" on finance_categories for all
  using (is_full_admin()) with check (is_full_admin());
create policy "member_categories_all" on member_categories for all
  using (is_full_admin()) with check (is_full_admin());
create policy "cash_accounts_all" on cash_accounts for all
  using (is_full_admin()) with check (is_full_admin());

-- programs: dibaca publik, ditulis pengurus penuh.
create policy "programs_select" on programs for select using (true);
create policy "programs_write" on programs for insert with check (is_full_admin());
create policy "programs_update" on programs for update using (is_full_admin()) with check (is_full_admin());
create policy "programs_delete" on programs for delete using (is_full_admin());

-- events: dibaca publik, ditulis pengurus penuh MAUPUN staff agenda.
create policy "events_select" on events for select using (true);
create policy "events_write" on events for insert with check (is_admin());
create policy "events_update" on events for update using (is_admin()) with check (is_admin());
create policy "events_delete" on events for delete using (is_admin());

-- settings & public_stats: dibaca publik (dipakai halaman donasi & beranda
-- tanpa login), ditulis pengurus (settings = pengurus penuh, public_stats =
-- pengurus manapun karena di-update otomatis setelah transaksi berubah).
create policy "settings_select" on settings for select using (true);
create policy "settings_write" on settings for all
  using (is_full_admin()) with check (is_full_admin());
create policy "public_stats_select" on public_stats for select using (true);
create policy "public_stats_write" on public_stats for all
  using (is_admin()) with check (is_admin());

-- supporters: siapapun (termasuk pengunjung tanpa login) boleh daftar baru,
-- tapi tidak boleh baca/ubah/hapus data pendaftar lain. Hanya pengurus penuh
-- yang boleh membaca & mengelola.
create policy "supporters_insert" on supporters for insert with check (true);
create policy "supporters_manage" on supporters for select using (is_full_admin());
create policy "supporters_update" on supporters for update using (is_full_admin()) with check (is_full_admin());
create policy "supporters_delete" on supporters for delete using (is_full_admin());

-- =========================================================
-- 4. REALTIME (opsional tapi dipakai app untuk update live)
-- =========================================================
alter publication supabase_realtime add table transactions, programs, events, members, org_structure, admins, settings, public_stats;
