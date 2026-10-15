-- MIGRATION 20261016120400_tenant_vitrin_seo_meta.sql
-- B4/G12 (2026-10-16): ofis vitrini icin elle SEO basligi ve aciklamasi.
-- Geri alma: supabase/rollbacks/20261016120400_tenant_vitrin_seo_meta.rollback.sql (girilen SEO basligi/aciklamasi KAYBOLUR;
--   kod sutunlar yokken vitrin metadata'si SEO kalibina duser, ayar ekranindaki alanlar kaydedilmez).
-- BAGIMLILIK: yok (tenants cekirdek tablosu; diger vitrin_* sutunlarindan bagimsiz).
--
-- NE: tenants.vitrin_seo_title text NULL (<=70) + tenants.vitrin_seo_description text NULL (<=160) + uzunluk CHECK'leri.
-- NEDEN: /app/ayarlar/vitrin ekraninda ofis kendi vitrin <title>/description metnini yazar; bos ise SEO kalibi kullanilir.
-- GUVENLIK: diger vitrin_* sutunlariyla ayni model: tenants RLS politikasi ve tablo duzeyi yetkiler degismez;
--   guard_tenant_lifecycle_fields yalniz yasam dongusu alanlarini korur (bu sutunlar ofis ayaridir).
-- ETKI: yalniz ek (iki nullable sutun + CHECK; mevcut satirlar NULL, tablo yeniden yazilmaz). Idempotent.

set local lock_timeout = '5s';

alter table public.tenants
  add column if not exists vitrin_seo_title text,
  add column if not exists vitrin_seo_description text;

alter table public.tenants
  drop constraint if exists tenants_vitrin_seo_title_len;
alter table public.tenants
  add constraint tenants_vitrin_seo_title_len check (vitrin_seo_title is null or char_length(vitrin_seo_title) <= 70);

alter table public.tenants
  drop constraint if exists tenants_vitrin_seo_description_len;
alter table public.tenants
  add constraint tenants_vitrin_seo_description_len check (vitrin_seo_description is null or char_length(vitrin_seo_description) <= 160);

comment on column public.tenants.vitrin_seo_title is 'Vitrin SEO basligi (<=70); null = SEO kalibi';
comment on column public.tenants.vitrin_seo_description is 'Vitrin SEO aciklamasi (<=160); null = tanitim metni ya da SEO kalibi';
