-- Setup Supabase Storage untuk poster kegiatan & QRIS donasi.
-- Jalankan SETELAH schema.sql (butuh fungsi is_admin()/is_full_admin()).
-- Supabase Dashboard -> SQL Editor -> New query -> Run

-- Bucket publik "images" — poster kegiatan di folder events/, QRIS di folder qris/.
insert into storage.buckets (id, name, public, file_size_limit)
values ('images', 'images', true, 8388608) -- 8MB
on conflict (id) do nothing;

-- Siapapun boleh membaca (gambar tampil di halaman publik).
create policy "images_public_read" on storage.objects for select
  using (bucket_id = 'images');

-- Poster kegiatan: pengurus penuh MAUPUN staff agenda boleh unggah/ubah/hapus.
create policy "images_events_write" on storage.objects for insert
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = 'events' and is_admin());
create policy "images_events_update" on storage.objects for update
  using (bucket_id = 'images' and (storage.foldername(name))[1] = 'events' and is_admin());
create policy "images_events_delete" on storage.objects for delete
  using (bucket_id = 'images' and (storage.foldername(name))[1] = 'events' and is_admin());

-- QRIS donasi: hanya pengurus penuh.
create policy "images_qris_write" on storage.objects for insert
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = 'qris' and is_full_admin());
create policy "images_qris_update" on storage.objects for update
  using (bucket_id = 'images' and (storage.foldername(name))[1] = 'qris' and is_full_admin());
create policy "images_qris_delete" on storage.objects for delete
  using (bucket_id = 'images' and (storage.foldername(name))[1] = 'qris' and is_full_admin());
