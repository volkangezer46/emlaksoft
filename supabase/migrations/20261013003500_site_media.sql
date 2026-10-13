-- Site medya kütüphanesi (SP6): ana sayfa görselleri için ÖZEL kova + kayıt tablosu.
--
-- NE: (1) `site-media` kovası: public=false, 8 MB, yalnız raster (avif/webp/jpeg/png). SVG ve video KABUL EDİLMEZ.
--     Kovaya istemci erişimi YOK (storage.objects için anon/authenticated politikası eklenmez); dosyaları yalnız sunucu
--     (service_role) yazar, okuma uygulama rotası /medya/<id>/<dosya> üzerinden yapılır (aynı köken, CSP değişmez).
--     (2) `site_media` tablosu: görselin alt metni (zorunlu, 1-140), ölçüleri, varyant listesi (480/960/1600 x AVIF/WebP),
--     küçük LQIP (<=200 bayt), kullanım yerleri (used_by: yayın/taslak yapılandırmasından hesaplanır).
--     RLS açık + FORCE, tüm roller REVOKE; erişim yalnız service_role (platform personeli kapısı uygulama katmanında).
-- KOTA: toplam 1 GB, dosya başına <=8 MB giriş (src/lib/site-media/quota.ts; kova sınırı ikinci savunma hattı).
-- KOD: tablo/kova yokken Medya ekranı "kurulum bekliyor" gösterir, ana sayfa görselsiz (bugünkü haliyle) çalışır.
-- GERİ ALMA: rollbacks/20261013003500_site_media.rollback.sql (UYARI: kova nesneleri ve tablo silinir).
-- RİSK: düşük; yalnız yeni tablo + yeni kova, mevcut nesnelere dokunmaz. platform_settings değişmez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('site-media', 'site-media', false, 8388608, array['image/avif', 'image/webp', 'image/jpeg', 'image/png']::text[])
    on conflict (id) do update
      set public = false,
          file_size_limit = 8388608,
          allowed_mime_types = array['image/avif', 'image/webp', 'image/jpeg', 'image/png']::text[];
  end if;
end $$;

create table if not exists public.site_media (
  id uuid primary key default gen_random_uuid(),
  -- Kovadaki klasör (<id>/); varyant dosyaları <path><dosya> altında.
  path text not null,
  alt text not null,
  title text,
  w integer not null,
  h integer not null,
  -- Saklanan varyantların toplam baytı (kota bu sütundan toplanır).
  bytes bigint not null,
  -- Kaynak dosyanın bayt imzasından belirlenen türü.
  mime text not null,
  -- [{file, w, h, format, bytes}] ; dosya adı içerik sürümü taşır (değiştirince yeni ad: kalıcı önbellek güvenli).
  variants jsonb not null default '[]'::jsonb,
  -- Bulanık yer tutucu (base64 WebP, öneksiz).
  lqip text,
  used_by text[] not null default '{}'::text[],
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint site_media_alt_len check (char_length(btrim(alt)) between 1 and 140),
  constraint site_media_title_len check (title is null or char_length(title) <= 140),
  constraint site_media_dims check (w > 0 and h > 0 and w <= 20000 and h <= 20000),
  constraint site_media_bytes check (bytes >= 0),
  constraint site_media_mime check (mime in ('image/avif', 'image/webp', 'image/jpeg', 'image/png')),
  constraint site_media_variants_array check (jsonb_typeof(variants) = 'array'),
  constraint site_media_lqip_len check (lqip is null or octet_length(lqip) <= 200),
  constraint site_media_path_format check (path ~ '^[0-9a-f-]{36}/$')
);

create index if not exists site_media_created_at_idx on public.site_media (created_at desc);

comment on table public.site_media is 'Site medya kütüphanesi (ana sayfa görselleri). Yalnız service_role; sunum /medya/<id>/<dosya> rotasından.';
comment on column public.site_media.used_by is 'Kullanım yerleri (ör. sitecontent.live:hero.image); yayın ve taslak yapılandırmalarından hesaplanır.';

alter table public.site_media enable row level security;
alter table public.site_media force row level security;

revoke all privileges on table public.site_media from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.site_media to service_role;

notify pgrst, 'reload schema';
