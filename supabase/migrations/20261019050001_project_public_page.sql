-- MIGRATION 20261019050001_project_public_page.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun/tablo yokken proje sayfasindaki "Galeri" ve "Paylasim"
--   kartlari "bu ortamda henuz etkin degil" der; /proje/[token] 404 doner.
-- Geri alma: supabase/rollbacks/20261019050001_project_public_page.rollback.sql
-- BAGIMLILIK: 20260726000075 (projects), current_active_tenant_id / has_effective_permission son govdeleri.
--
-- NE (PF-04, proje paylasim sayfasi):
--   1) projects.share_token (43 karakter base64url, 256 bit) + share_enabled + share_show_prices + shared_at:
--      token'li herkese acik proje sayfasi (/proje/[token]); varsayilan KAPALI, noindex. Fiyat gosterimi ayri anahtar.
--   2) project_media: proje galerisi (gorsel / kat plani). Dosya OZEL `project-media` kovasinda; yazma ve imzali okuma
--      YALNIZ sunucu (service_role) — storage.objects'e anon/authenticated politikasi EKLENMEZ. Satir okuma/yazma
--      ayni ofis + projects yetkisi (RLS).
set local lock_timeout = '5s';

alter table public.projects
  add column if not exists share_token text,
  add column if not exists share_enabled boolean not null default false,
  add column if not exists share_show_prices boolean not null default true,
  add column if not exists shared_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'projects_share_token_format' and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_share_token_format
      check (share_token is null or share_token ~ '^[A-Za-z0-9_-]{32,64}$');
  end if;
end $$;

create unique index if not exists idx_projects_share_token
  on public.projects (share_token)
  where share_token is not null;

comment on column public.projects.share_token is 'PF-04: /proje/[token] herkese acik proje sayfasi anahtari (null = hic paylasilmadi).';
comment on column public.projects.share_enabled is 'PF-04: paylasim sayfasi acik mi (kapatilinca link 404).';
comment on column public.projects.share_show_prices is 'PF-04: paylasim sayfasinda daire fiyatlari gorunsun mu (kapaliysa "Fiyat icin arayin").';

create table if not exists public.project_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'floorplan')),
  storage_path text not null check (char_length(storage_path) <= 300),
  caption text check (caption is null or char_length(caption) <= 140),
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  width integer check (width is null or (width > 0 and width <= 100000)),
  height integer check (height is null or (height > 0 and height <= 100000)),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_media_project
  on public.project_media (tenant_id, project_id, sort_order, created_at);
create unique index if not exists idx_project_media_one_cover
  on public.project_media (project_id)
  where is_cover;

alter table public.project_media enable row level security;

drop policy if exists project_media_select on public.project_media;
create policy project_media_select on public.project_media
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('projects'::text, 'view'::text))
  );

drop policy if exists project_media_update on public.project_media;
create policy project_media_update on public.project_media
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('projects'::text, 'edit'::text))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('projects'::text, 'edit'::text))
  );

drop policy if exists project_media_delete on public.project_media;
create policy project_media_delete on public.project_media
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('projects'::text, 'edit'::text))
  );

-- Ekleme yalniz sunucu (dosya ozel kovaya service_role ile yazildiktan sonra satir acilir).
revoke all privileges on table public.project_media from public, anon, authenticated;
grant select, update, delete on table public.project_media to authenticated;
grant all on table public.project_media to service_role;

comment on table public.project_media is
  'PF-04: proje galerisi (gorsel / kat plani); dosya ozel project-media kovasinda, ekleme yalniz service_role, okuma projects:view.';

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('project-media', 'project-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp']::text[])
    on conflict (id) do update
      set public = false,
          file_size_limit = 8388608,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
