-- Ilan havuzu: YENI kurulan ofislerde varsayilan ACIK + havuz kaynagi 'extension' (Ilan Kontrol eklentisi).
--
-- NEDEN: Kullanici kurgusu "ofise gelen ilan havuza duser, uzmanlik/bolgeye gore atanir". Varsayilan kapali oldugu icin
--   yeni ofis bu akisi hic gormuyordu. Mevcut ofislerin ayari DEGISMEZ (yalniz sutun varsayilani degisir; satir guncellenmez).
-- NE: (1) tenants.listing_pool_enabled varsayilani true. (2) listing_pool_entries.source CHECK'ine 'extension' eklenir.
--     (3) advisor_specialties / advisor_regions: is_sample (ornek veri temizligi).
-- GERI ALMA: rollbacks/20261010000800_listing_pool_default_on.rollback.sql.
-- RISK: dusuk (yalniz varsayilan + genisleyen CHECK; mevcut satirlar gecerli kalir).
-- BAGIMLILIK: 20260816001200, 20260816001500.

set local lock_timeout = '5s';

alter table public.tenants alter column listing_pool_enabled set default true;
comment on column public.tenants.listing_pool_enabled is 'Yeni ilanlar önce havuza düşsün mü (yeni ofiste varsayılan açık; mevcut ofisler değişmedi).';

alter table public.listing_pool_entries drop constraint if exists listing_pool_entries_source_check;
alter table public.listing_pool_entries
  add constraint listing_pool_entries_source_check
  check (source in ('manual', 'import', 'portal_form', 'network', 'api', 'transfer', 'extension'));

-- Ornek (demo) uzmanlik/bolge satirlari "Gercek kullanima gec" ile silinebilsin: is_sample isareti. Gercek satirlar etkilenmez.
alter table public.advisor_specialties add column if not exists is_sample boolean not null default false;
alter table public.advisor_regions add column if not exists is_sample boolean not null default false;
