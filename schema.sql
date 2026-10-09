-- RANCANGAN AWAL SAJA. Tinjau, uji, dan lengkapi RLS sebelum produksi.
create extension if not exists pgcrypto;

create type public.article_status as enum ('draft','review','approved','scheduled','published','archived');
create type public.report_status as enum ('submitted','reviewing','needs_info','approved','rejected','archived');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  summary text,
  body text not null,
  category_id uuid references public.categories(id),
  image_path text,
  author_label text not null default 'Redaksi Lapor Berita',
  source_url text,
  status public.article_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.public_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  proposed_category_id uuid references public.categories(id),
  source_url text,
  evidence_paths text[] not null default '{}',
  status public.report_status not null default 'submitted',
  reviewer_notes text,
  published_article_id uuid references public.articles(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- Identitas disimpan terpisah; aktifkan RLS dan akses server/admin khusus
-- sebelum memasukkan data pribadi sungguhan.
create table public.reporter_private_data (
  report_id uuid primary key references public.public_reports(id) on delete cascade,
  full_name text not null,
  nik_ciphertext text,
  ktp_private_path text,
  consent_version text not null,
  retention_until timestamptz,
  created_at timestamptz not null default now()
);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  content_json jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.navigation_items (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  href text not null,
  position integer not null default 0,
  visible boolean not null default true,
  parent_id uuid references public.navigation_items(id),
  updated_at timestamptz not null default now()
);

create table public.site_settings (
  key text primary key,
  value_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  object_type text not null,
  object_id text,
  outcome text not null,
  created_at timestamptz not null default now()
);

-- Jangan aktifkan penerimaan data pribadi sebelum:
-- 1) RLS dibuat dan diuji untuk setiap tabel,
-- 2) bucket Storage privat dibuat,
-- 3) hanya server tepercaya yang dapat mengakses data identitas,
-- 4) alur persetujuan, retensi, penghapusan, dan audit diverifikasi.
