-- MIGRATION 20261020070001_vitrin_saved_search_filters.sql
-- PUB-2 (B1 kalanı): vitrin "Aramamı kaydet" kutusu ziyaretçinin o an uyguladığı GELİŞMİŞ süzgeçleri de saklar
-- (tür, mahalle, m², bina yaşı, kat, eşyalı, site içi, krediye uygun). Günlük vitrin-eslesme cron'u yeni yayına giren
-- ilanı bu süzgeçlerle de eşleştirir; "120 m² üstü site içi" arayan ziyaretçi için 70 m² ilan bildirimi gitmez.
-- Anahtar adları vitrin_listing_search (20261019010000) jsonb girdisiyle BİREBİR; doğrulama kodda
-- (src/lib/vitrin/saved-search-filters.ts sanitizeSavedSearchFilters), burada yalnız biçim + boyut sınırı.
-- KOD DAVRANIŞI: sütun yokken kayıt ve cron eski alanlarla çalışır (sütunsuz yeniden deneme).
-- GERİ ALMA: supabase/rollbacks/20261020070001_vitrin_saved_search_filters.rollback.sql
-- RİSK: düşük (varsayılanlı yeni sütun; mevcut satırlar '{}' = eski davranış). İdempotent.

set local lock_timeout = '5s';

alter table public.vitrin_saved_searches
  add column if not exists filters jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vitrin_saved_searches_filters_shape') then
    alter table public.vitrin_saved_searches
      add constraint vitrin_saved_searches_filters_shape
      check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 1000);
  end if;
end $$;

comment on column public.vitrin_saved_searches.filters is
  'Gelişmiş vitrin süzgeçleri (type, neighborhood, sqm_min, sqm_max, age_max, floor, furnished, in_site, credit); boş = yok.';
