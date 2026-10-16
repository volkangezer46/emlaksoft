-- Geri alma: 20261020070001_vitrin_saved_search_filters.sql
-- Sütun kaldırılır; kayıtlı aramalar eski (işlem türü, il/ilçe, fiyat, oda) kriterleriyle eşleşmeye devam eder.
-- DİKKAT: ziyaretçilerin kaydettiği gelişmiş süzgeçler silinir.
set local lock_timeout = '5s';

alter table public.vitrin_saved_searches drop constraint if exists vitrin_saved_searches_filters_shape;
alter table public.vitrin_saved_searches drop column if exists filters;
