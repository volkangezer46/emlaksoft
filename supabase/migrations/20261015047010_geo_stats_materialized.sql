-- MIGRATION 20261015047010_geo_stats_materialized.sql
-- YD7 (2026-10-15): geo sayimlari MATERIALIZED VIEW'dan okunur.
-- Geri alma: supabase/rollbacks/20261015047010_geo_stats_materialized.rollback.sql
-- BAGIMLILIK: public.geo_provinces / geo_districts / geo_neighborhoods (is_active NOT NULL) ve 20260722000018 gorunumleri.
--
-- AMAC: geo_province_stats / geo_district_stats duz gorunumdu: her okumada 32 bin mahalle taraniyordu
--   (pg_stat_user_tables geo_neighborhoods seq_tup_read 71,7 milyon; sorgu basina 10-24 ms, soguk 195 ms). Ayrica
--   /admin/geo saglik ekrani 6 ayri count(*) (il/ilce/mahalle x aktif/pasif) atiyordu. Geo verisi nadiren degisir.
--
-- NE YAPAR:
--   * geo_province_stats ve geo_district_stats AYNI AD ve AYNI KOLONLARLA materialized view olur (okuyan kod degismez)
--     + benzersiz indeks (REFRESH ... CONCURRENTLY icin zorunlu; okuyucu yenileme sirasinda beklemez).
--   * Yeni geo_level_counts: (level, active) basina satir sayisi; saglik ekraninin 6 sayimi tek okumaya iner.
--   * refresh_geo_stats(): uc gorunumu CONCURRENTLY yeniler (SECURITY DEFINER, yalniz service_role). Cagiranlar:
--     operational-retention cron'unun `geoStats` adimi (gunluk) ve /admin/geo yazimlari (ekle, pasife al, tasi, birlestir,
--     geri al, ice aktar) sonrasinda.
--   * Erisim daralir: gorunumler anon/authenticated'a ACIK DEGIL (yalniz service_role okur; kodda tek okuyucu admin sayfalari).
-- ETKI: davranis (sayimlar son yenilemedeki durumu gosterir; yazimdan hemen sonra yenilenir). Veri degismez.
-- IDEMPOTENT: gorunum zaten materialized ise yeniden kurulmaz.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.geo_provinces') is null
     or pg_catalog.to_regclass('public.geo_districts') is null
     or pg_catalog.to_regclass('public.geo_neighborhoods') is null then
    raise exception 'geo tablolari yok.';
  end if;
  -- Eski duz gorunumler (20260722000018) kaldirilir; ayni ad materialized view olarak kurulur.
  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'geo_province_stats' and c.relkind = 'v') then
    drop view public.geo_province_stats;
  end if;
  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'geo_district_stats' and c.relkind = 'v') then
    drop view public.geo_district_stats;
  end if;
end $$;

create materialized view if not exists public.geo_province_stats as
select
  p.id as province_id,
  count(distinct d.id) as district_count,
  count(n.id) as neighborhood_count
from public.geo_provinces p
left join public.geo_districts d on d.province_id = p.id
left join public.geo_neighborhoods n on n.district_id = d.id
group by p.id;

create unique index if not exists geo_province_stats_province_id_key on public.geo_province_stats (province_id);

create materialized view if not exists public.geo_district_stats as
select
  d.id as district_id,
  count(n.id) as neighborhood_count
from public.geo_districts d
left join public.geo_neighborhoods n on n.district_id = d.id
group by d.id;

create unique index if not exists geo_district_stats_district_id_key on public.geo_district_stats (district_id);

create materialized view if not exists public.geo_level_counts as
select 'province'::text as level, p.is_active as active, count(*)::bigint as n from public.geo_provinces p group by p.is_active
union all
select 'district'::text, d.is_active, count(*)::bigint from public.geo_districts d group by d.is_active
union all
select 'neighborhood'::text, n.is_active, count(*)::bigint from public.geo_neighborhoods n group by n.is_active;

create unique index if not exists geo_level_counts_level_active_key on public.geo_level_counts (level, active);

revoke all on public.geo_province_stats, public.geo_district_stats, public.geo_level_counts from public, anon, authenticated;
grant select on public.geo_province_stats, public.geo_district_stats, public.geo_level_counts to service_role;

comment on materialized view public.geo_province_stats is
  'YD7: il basina ilce/mahalle sayisi (materialized; refresh_geo_stats() yeniler).';
comment on materialized view public.geo_district_stats is
  'YD7: ilce basina mahalle sayisi (materialized; refresh_geo_stats() yeniler).';
comment on materialized view public.geo_level_counts is
  'YD7: seviye x aktiflik satir sayisi (/admin/geo saglik; materialized; refresh_geo_stats() yeniler).';

create or replace function public.refresh_geo_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently public.geo_province_stats;
  refresh materialized view concurrently public.geo_district_stats;
  refresh materialized view concurrently public.geo_level_counts;
  return jsonb_build_object(
    'provinces', (select count(*) from public.geo_province_stats),
    'districts', (select count(*) from public.geo_district_stats)
  );
end;
$$;

revoke all on function public.refresh_geo_stats() from public, anon, authenticated;
grant execute on function public.refresh_geo_stats() to service_role;

comment on function public.refresh_geo_stats() is
  'YD7: geo sayim gorunumlerini CONCURRENTLY yeniler (yalniz service_role; cron operational-retention + /admin/geo yazimlari).';

notify pgrst, 'reload schema';
