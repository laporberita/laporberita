-- LAPOR BERITA: migrasi lokasi artikel
-- Jalankan satu kali di Supabase SQL Editor setelah backup.
-- Tidak menghapus tabel atau berita lama.
alter table public.articles add column if not exists district text;
alter table public.articles add column if not exists village text;
alter table public.articles add column if not exists location_manual text;
alter table public.articles add column if not exists location_detail text;
alter table public.articles add column if not exists region_type text;
alter table public.articles add column if not exists province text;
alter table public.articles add column if not exists regency text;
alter table public.articles add column if not exists city text;
alter table public.articles add column if not exists media_urls text[] not null default '{}';
alter table public.articles add column if not exists author_label text not null default 'Redaksi LAPOR BERITA';
create index if not exists articles_region_type_idx on public.articles(region_type);
create index if not exists articles_province_idx on public.articles(province);
create index if not exists articles_regency_idx on public.articles(regency);
create index if not exists articles_city_idx on public.articles(city);
create index if not exists articles_published_at_idx on public.articles(published_at desc) where status = 'published';
-- Skrip ini tidak mengubah RLS. Jangan pernah menaruh service_role key di frontend.
