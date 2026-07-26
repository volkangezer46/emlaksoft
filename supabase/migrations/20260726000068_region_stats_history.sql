-- Bölge istatistik tarihçesi (aylık snapshot)
--
-- ============================================================================
-- NEDEN
-- ============================================================================
-- `region_stats()` fonksiyonu her çağrıda ANLIK durumu hesaplar — "bu ilçenin
-- medyan m² fiyatı 6 ay önce neydi?" sorusunun cevabı yoktur, çünkü geçmiş
-- hiçbir yerde saklanmıyor. Bu tablo, /api/cron/bolge-snapshot cron'unun ayda
-- bir kez tenant × ilçe × işlem tipi başına yazdığı tek satırlık fotoğraftır.
-- /app/bolge-analizi bu tarihçeden 12 aylık medyan ₺/m² trend çizgisi çizer.
--
-- YAZMA yalnızca service_role (cron, admin client) üzerinden yapılır; kiracı
-- kullanıcıları yalnız KENDİ satırlarını okur (current_tenant_id() deseni —
-- JWT claim ifadesini satır içi kopyalamayın, bkz. 20260725000054).

create table if not exists public.region_stats_history (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  district_id       uuid not null references public.geo_districts(id) on delete cascade,
  -- Ay başı tarihi (2026-07-01 gibi). Cron hangi gün çalışırsa çalışsın ay
  -- başına yuvarlar; unique kısıt sayesinde aynı ay ikinci kez çalışmak
  -- güncelleme (upsert) olur, mükerrer satır üretmez.
  period            date not null check (period = date_trunc('month', period)::date),
  -- region_stats()'a verilen filtreyle birebir: NULL filtre 'Tümü' olarak yazılır.
  tx_type           text not null check (tx_type in ('Tümü', 'Satılık', 'Kiralık')),
  median_sqm_price  numeric,
  active_count      integer not null default 0,
  avg_days_listed   numeric,
  closed_count      integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (tenant_id, district_id, period, tx_type)
);

-- Trend sorgusu yolu: tenant + ilçe + tip → son 12 ay. Unique kısıtın indeksi
-- (tenant_id, district_id, period, tx_type) sıralı olduğundan period aradan
-- önce gelir; okuma deseni için tx_type'ı öne alan ayrı indeks daha isabetli.
create index if not exists idx_region_stats_history_lookup
  on public.region_stats_history (tenant_id, district_id, tx_type, period desc);

alter table public.region_stats_history enable row level security;

drop policy if exists region_stats_history_tenant_read on public.region_stats_history;
create policy region_stats_history_tenant_read on public.region_stats_history
  for select
  using (tenant_id = public.current_tenant_id());

-- Yazma politikası bilinçli olarak YOK: satırları yalnızca cron (service_role,
-- RLS'i baypas eder) üretir. authenticated'a insert/update grant'i verilmiyor.
grant select on public.region_stats_history to authenticated;
grant all on public.region_stats_history to service_role;

comment on table public.region_stats_history is
  'Aylık bölge istatistik fotoğrafı: /api/cron/bolge-snapshot tarafından tenant × ilçe × işlem tipi başına upsert edilir. Trend grafikleri bu tablodan okunur.';
comment on column public.region_stats_history.period is
  'Snapshot ayı — her zaman ay başı tarihi (date_trunc month).';
comment on column public.region_stats_history.tx_type is
  'region_stats() filtresi: Tümü (filtresiz), Satılık veya Kiralık.';
