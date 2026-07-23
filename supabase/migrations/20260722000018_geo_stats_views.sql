-- Admin geo ekranlarında 81 il / 973 ilçe için tek sorguda kapsama sayıları.
-- 32k+ mahalleyi sayım için istemciye çekmek yerine view üzerinden agregasyon.

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
