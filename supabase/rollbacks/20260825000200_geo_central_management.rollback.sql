-- Rollback: 20260825000200_geo_central_management (eski taslak adı 20261005000600; 2026-10-05 terfi etti).
-- Elle çalıştırılır; schema_migrations ledger satırına DOKUNMAZ.
-- UYARI (veri kaybı): coğrafya sürüm geçmişi (geo_data_versions), alias/eski adlar (geo_aliases), ofis bildirimleri
-- (geo_change_requests) ve demo_requests.province_id/district_id değerleri KALICI silinir. Bu migration ile yapılmış
-- birleştirme/taşıma işlemlerinin referans değişiklikleri GERİ ALINMAZ (önce /admin/geo'dan birleştirmeleri geri alın).
-- geo_* tablolarına eklenen description/deactivated_at/source/version_id sütunları da düşer; pasife alınmış kayıtlar
-- is_active=false olarak KALIR.
drop function if exists public.geo_move(text, uuid, uuid);
drop function if exists public.geo_merge_undo(uuid, uuid);
drop function if exists public.geo_merge(text, uuid, uuid, uuid, text);
drop function if exists public.geo_usage_rows(text, uuid, text, int);
drop function if exists public.geo_usage_totals(text, uuid[]);
drop function if exists public.geo_usage_counts(text, uuid);

drop table if exists public.geo_change_requests;
drop table if exists public.geo_aliases;
drop table if exists public.geo_data_versions;

alter table public.demo_requests
  drop column if exists district_id,
  drop column if exists province_id;

alter table public.geo_neighborhoods
  drop column if exists version_id,
  drop column if exists source,
  drop column if exists deactivated_at,
  drop column if exists description;
alter table public.geo_districts
  drop column if exists version_id,
  drop column if exists source,
  drop column if exists deactivated_at,
  drop column if exists description;
alter table public.geo_provinces
  drop column if exists version_id,
  drop column if exists source,
  drop column if exists deactivated_at,
  drop column if exists description;
