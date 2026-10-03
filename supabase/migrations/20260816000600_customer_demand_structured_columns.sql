-- Faz 2 / 06: customer_demands yapılandırılmış ek sütunlar (belge 3d, "sorgulanacak alanlar sütuna çıkar").
--
-- NEDEN: Faz 1'de bu alanlar criteria jsonb içinde. Eşleştirme motoru ve listeler bunları süzecekse
-- tipli/indexlenebilir sütun gerekir. Hepsi NULLABLE veya güvenli varsayılanlı: mevcut satırlar ve mevcut
-- yazan kod (demands.ts) olduğu gibi çalışır; backfill YOK (eski değerler criteria'da kalır, motor ikisini okur).
-- KARAR: ayrı `demand_features` tablosu AÇILMAZ (belge: portföy features sözlüğüyle aynı anahtarlar,
--   criteria.features jsonb tercih). `demand_locations` (çoklu bölge) bu migration'a ALINMADI: ayrı iş,
--   tekil geo sütunlarıyla birleşik okuma kuralı önce kararlaştırılmalı.
-- RLS: tablo zaten RLS'li (tenant + demands yetkisi); sütun eklemek politikaları değiştirmez.
-- GERİ ALMA: rollbacks/20260816000600_customer_demand_structured_columns.rollback.sql (sütunlar düşer;
--   kod bu sütunlara yazmaya başladıysa önce o veriyi criteria'ya taşıyın).
-- RİSK: düşük (additive). `add column ... default` sabit varsayılanlarla tabloyu yeniden yazmaz (PG11+).

alter table public.customer_demands
  add column if not exists currency text not null default 'TRY'
    check (currency in ('TRY', 'USD', 'EUR', 'GBP')),
  add column if not exists budget_includes_loan boolean,
  add column if not exists swap_ok boolean,
  add column if not exists max_sqm numeric check (max_sqm is null or max_sqm >= 0),
  add column if not exists floor_min integer,
  add column if not exists floor_max integer,
  add column if not exists max_building_age integer check (max_building_age is null or max_building_age >= 0),
  add column if not exists required_keys text[] not null default '{}';

alter table public.customer_demands
  drop constraint if exists customer_demands_floor_range;
alter table public.customer_demands
  add constraint customer_demands_floor_range
  check (floor_min is null or floor_max is null or floor_min <= floor_max) not valid;

comment on column public.customer_demands.required_keys is
  'Zorunlu özellik anahtarları (portföy features sözlüğüyle aynı anahtarlar).';
comment on column public.customer_demands.currency is
  'Bütçe para birimi (budget_min/max bu birimdedir). Varsayılan TRY.';
