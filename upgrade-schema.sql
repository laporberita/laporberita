-- MIGRASI RINGAN LAPOR BERITA PENDIDIKAN
-- Jalankan hanya setelah backup. Tidak menghapus tabel atau data lama.
alter table public.articles add column if not exists region_type text;
alter table public.articles add column if not exists province text;
alter table public.articles add column if not exists regency text;
alter table public.articles add column if not exists city text;
alter table public.articles add column if not exists media_urls text[] not null default '{}';
alter table public.articles add column if not exists author_label text not null default 'Redaksi LAPOR BERITA';
create index if not exists articles_published_at_idx on public.articles (published_at desc) where status = 'published';
create index if not exists articles_region_type_idx on public.articles (region_type);
-- Catatan: kebijakan RLS yang sudah ada tidak diubah oleh skrip ini.
-- Jangan memasukkan service_role key ke HTML/JavaScript publik.
