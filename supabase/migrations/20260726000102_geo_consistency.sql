-- Geo tutarlılık denetimi — çeyreklik geo-sync cron'unun tek RPC'si.
--
-- Neden SQL fonksiyonu: ilçe (~973) ve mahalle (32k+) satırlarını PostgREST
-- üzerinden çekip JS tarafında diff'lemek hem yavaş hem URL limitine takılır.
-- Sayımların hepsi tek round-trip'te, index'li join'lerle burada yapılır.
--
-- Dönen jsonb alanları:
--   provinces_without_district : aktif il, hiç ilçesi yok
--   orphan_districts           : province_id'si geo_provinces'ta olmayan ilçe
--   districts_without_neighborhood : aktif ilçe, hiç mahallesi yok
--   orphan_neighborhoods       : district_id'si geo_districts'te olmayan mahalle
--   properties_orphan_province / properties_orphan_district
--   demands_orphan_province    / demands_orphan_district
--
-- Orphan FK sayıları normalde 0'dır (kolonlarda gerçek FK var); denetim yine de
-- yapılır çünkü geo:sync script'i doğrudan pg ile toplu yazar ve gelecekte bir
-- constraint düşürülürse/veri restore edilirse sessiz bozulma buradan yakalanır.

create or replace function public.geo_consistency_check()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'provinces_without_district', (
      select count(*) from geo_provinces p
      where p.is_active
        and not exists (select 1 from geo_districts d where d.province_id = p.id)
    ),
    'orphan_districts', (
      select count(*) from geo_districts d
      where not exists (select 1 from geo_provinces p where p.id = d.province_id)
    ),
    'districts_without_neighborhood', (
      select count(*) from geo_districts d
      where d.is_active
        and not exists (select 1 from geo_neighborhoods n where n.district_id = d.id)
    ),
    'orphan_neighborhoods', (
      select count(*) from geo_neighborhoods n
      where not exists (select 1 from geo_districts d where d.id = n.district_id)
    ),
    'properties_orphan_province', (
      select count(*) from properties x
      where x.province_id is not null
        and not exists (select 1 from geo_provinces p where p.id = x.province_id)
    ),
    'properties_orphan_district', (
      select count(*) from properties x
      where x.district_id is not null
        and not exists (select 1 from geo_districts d where d.id = x.district_id)
    ),
    'demands_orphan_province', (
      select count(*) from customer_demands x
      where x.province_id is not null
        and not exists (select 1 from geo_provinces p where p.id = x.province_id)
    ),
    'demands_orphan_district', (
      select count(*) from customer_demands x
      where x.district_id is not null
        and not exists (select 1 from geo_districts d where d.id = x.district_id)
    )
  );
$$;

-- Yalnız cron (service_role) çağırır; tarayıcı rollerinden geri al.
revoke execute on function public.geo_consistency_check() from public, anon, authenticated;
grant execute on function public.geo_consistency_check() to service_role;
