-- Geri alma: 20261015044000_field_capture.sql
-- Cevrimdisi kuyruk istek kimlikleri tablosu ve fotograf boyut sutunlari duser. Kod tablo yokken cift kayit frenini atlar,
-- sutun yokken boyutu kaydetmez (olcum ve uyari yalniz yukleme oturumunda gorunur). Baska nesneye dokunmaz.
drop index if exists public.geo_neighborhoods_latlng_idx;
drop index if exists public.geo_districts_latlng_idx;
drop table if exists public.client_submissions;
alter table public.property_media drop constraint if exists property_media_dimensions_check;
alter table public.property_media drop column if exists width;
alter table public.property_media drop column if exists height;
notify pgrst, 'reload schema';
