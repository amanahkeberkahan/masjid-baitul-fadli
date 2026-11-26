-- Modul Donatur Tetap: data donatur, pembayaran per bulan, dan pengingat.
-- Jalankan SETELAH schema.sql (butuh tabel supporters/transactions dan fungsi is_full_admin()).
-- Aman dijalankan berkali-kali.
-- Supabase Dashboard -> SQL Editor -> New query -> Run

-- ---------------------------------------------------------
-- 1. Kolom tambahan di tabel supporters
-- ---------------------------------------------------------
-- status: 'baru' (daftar sendiri lewat website, belum dikonfirmasi) | 'aktif' | 'nonaktif'
alter table supporters add column if not exists reminder_day int not null default 1;      -- tanggal pengingat tiap bulan (1-28)
alter table supporters add column if not exists method text not null default 'Transfer';  -- jalur: 'Transfer' (m-banking/QRIS) | 'Diambil' (dijemput ke rumah)
alter table supporters alter column method set default 'Transfer';
alter table supporters add column if not exists collector text not null default '';       -- petugas pengambil (jalur Diambil)
alter table supporters add column if not exists pickup_note text not null default '';     -- patokan rumah / waktu yang pas
alter table supporters add column if not exists notes text not null default '';
alter table supporters add column if not exists anonymous boolean not null default false; -- tampil sebagai "Hamba Allah" di rekap publik
alter table supporters add column if not exists start_period text not null default '';    -- 'YYYY-MM' mulai berkomitmen
alter table supporters add column if not exists last_reminded_at timestamptz;
alter table supporters add column if not exists updated_at timestamptz;
alter table supporters add column if not exists updated_by uuid references auth.users(id);

do $$ begin
  alter table supporters add constraint supporters_reminder_day_range check (reminder_day between 1 and 28);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------
-- 2. Pembayaran donatur per periode
-- ---------------------------------------------------------
create table if not exists supporter_payments (
  id uuid primary key default gen_random_uuid(),
  supporter_id uuid not null references supporters(id) on delete cascade,
  period text not null,                 -- 'YYYY-MM'
  amount numeric not null default 0,
  paid_at date not null default current_date,
  method text not null default 'QRIS', -- cara bayar aktual: 'QRIS' | 'Transfer' | 'Tunai'
  collector text not null default '',   -- petugas yang menerima tunai
  deposited_at timestamptz,             -- tunai: kapan diserahkan ke bendahara (null = masih di petugas)
  transaction_id uuid references transactions(id) on delete set null, -- baris kas yang ikut dibuat
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (supporter_id, period)
);
create index if not exists supporter_payments_period_idx on supporter_payments (period);
-- Untuk tabel yang sudah terlanjur dibuat dengan versi file sebelumnya:
alter table supporter_payments add column if not exists collector text not null default '';
alter table supporter_payments add column if not exists deposited_at timestamptz;
-- Pembayaran transfer/QRIS dianggap langsung diterima rekening masjid.
update supporter_payments set deposited_at = created_at where method <> 'Tunai' and deposited_at is null;
-- Nilai jalur lama (QRIS/Tunai) diseragamkan.
update supporters set method = 'Transfer' where method in ('QRIS', '');
update supporters set method = 'Diambil' where method = 'Tunai';

alter table supporter_payments enable row level security;
drop policy if exists "supporter_payments_all" on supporter_payments;
create policy "supporter_payments_all" on supporter_payments for all
  using (is_full_admin()) with check (is_full_admin());

-- Pendaftar publik hanya boleh mengisi data dasar dengan status 'baru'
-- (sebelumnya with check (true) memungkinkan langsung mengisi status 'aktif').
drop policy if exists "supporters_insert" on supporters;
create policy "supporters_insert" on supporters for insert
  with check (is_full_admin() or status = 'baru');

-- ---------------------------------------------------------
-- 3. Realtime
-- ---------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'supporters') then
    alter publication supabase_realtime add table supporters;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'supporter_payments') then
    alter publication supabase_realtime add table supporter_payments;
  end if;
end $$;

-- ---------------------------------------------------------
-- 4. Kategori kas "Donatur Tetap"
-- ---------------------------------------------------------
insert into finance_categories (name, type)
select 'Donatur Tetap', 'Pemasukan'
where not exists (select 1 from finance_categories where name = 'Donatur Tetap' and type = 'Pemasukan');

-- ---------------------------------------------------------
-- 5. Data awal donatur tetap MBF (nomor WA dilengkapi lewat aplikasi)
-- ---------------------------------------------------------
insert into supporters (name, amount, frequency, status, anonymous)
select v.name, v.amount, 'Bulanan', 'aktif', v.anonymous
from (values
  ('Dito', 100000, false),
  ('Mario', 300000, false),
  ('Eko Fajar', 100000, false),
  ('Iltizam', 200000, false),
  ('Ezif', 200000, false),
  ('Ahmad Mubarok', 100000, false),
  ('Luluk', 100000, false),
  ('Agus', 150000, false),
  ('Rizal Rufki F', 100000, false),
  ('Yogi Jasmin', 200000, false),
  ('Hamba Allaah', 100000, true),
  ('Azzam/Yusuf', 150000, false),
  ('Pak Khusnul', 200000, false),
  ('Mas Dani', 100000, false),
  ('Firman', 100000, false),
  ('Kholid Fathoni', 100000, false),
  ('Andi Witim', 100000, false)
) as v(name, amount, anonymous)
where not exists (select 1 from supporters s where lower(s.name) = lower(v.name));

-- ---------------------------------------------------------
-- 6. Template pesan pengingat WhatsApp (kosong = pakai pesan bawaan aplikasi)
-- ---------------------------------------------------------
alter table settings add column if not exists reminder_template text not null default '';  -- jalur transfer/QRIS
alter table settings add column if not exists pickup_template text not null default '';    -- jalur diambil ke rumah
