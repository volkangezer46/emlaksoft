-- Geri alma: 20261015047010_geo_stats_materialized.sql
-- Materialized view'lar ve yenileme fonksiyonu kaldirilir; 20260722000018'deki duz gorunumler AYNI tanim ve izinlerle
-- geri kurulur. Veri degismez. Kod geo_level_counts / refresh_geo_stats yokken eski ayri sayimlara duser.
drop function if exists public.refresh_geo_stats();
drop materialized view if exists public.geo_level_counts;
drop materialized view if exists public.geo_province_stats;
drop materialized view if exists public.geo_district_stats;

create or replace view public.geo_province_stats as
select
  p.id as province_id,
  count(distinct d.id) as district_count,
  count(n.id) as neighborhood_count
from public.geo_provinces p
left join public.geo_districts d on d.province_id = p.id
left join public.geo_neighborhoods n on n.district_id = d.id
group by p.id;

create or replace view public.geo_district_stats as
select
  d.id as district_id,
  count(n.id) as neighborhood_count
from public.geo_districts d
left join public.geo_neighborhoods n on n.district_id = d.id
group by d.id;

grant select on public.geo_province_stats to anon, authenticated, service_role;
grant select on public.geo_district_stats to anon, authenticated, service_role;
notify pgrst, 'reload schema';
