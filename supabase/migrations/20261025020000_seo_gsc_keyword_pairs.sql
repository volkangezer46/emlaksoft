-- SEO merkezi "Anahtar kelimeler" sekmesi: Search Console sorgu x sayfa ozeti, guncel pencere ve ONCEKI esit pencere.
--
-- Platform verisidir (tenant verisi DEGIL): seo_gsc_daily (20261013003400) yalniz service_role'e aciktir; bu fonksiyon
--   da yalniz service_role'e verilir (anon/authenticated REVOKE). Kisisel veri yok (GSC sorgulari Google'in anonimlestirdigi
--   arama ifadeleridir).
-- Pencere SON VERI GUNUNE gore kurulur (GSC 2-3 gun gecikir; now() yerine max(day)): guncel = son p_days gun, onceki =
--   ondan onceki p_days gun. Kazanan/kaybeden, firsat (pozisyon 4-20) ve yamyamlik (ayni sorguda birden cok sayfa)
--   uygulama tarafinda (src/lib/seo/keywords.ts, SAF) hesaplanir.
-- KOD DAVRANISI: fonksiyon yokken ekran "kurulum bekliyor" der; diger her sey calisir.
-- GERI ALMA: supabase/rollbacks/20261025020000_seo_gsc_keyword_pairs.rollback.sql. RISK: dusuk (yalniz yeni fonksiyon).

create or replace function public.seo_gsc_keyword_pairs(p_days integer, p_limit integer default 3000)
returns table (
  query text,
  page text,
  clicks bigint,
  impressions bigint,
  avg_position double precision,
  prev_clicks bigint,
  prev_impressions bigint,
  prev_position double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select greatest(1, least(coalesce(p_days, 28), 180)) as d, (select max(x.day) from public.seo_gsc_daily x) as last_day
  ),
  w as (
    select
      g.query as q,
      g.page as pg,
      (g.day > b.last_day - b.d) as cur,
      g.clicks as c,
      g.impressions as i,
      g.position as pos
    from public.seo_gsc_daily g
    cross join b
    where b.last_day is not null
      and g.query <> ''
      and g.day > b.last_day - 2 * b.d
  )
  select
    w.q,
    w.pg,
    coalesce(sum(w.c) filter (where w.cur), 0)::bigint,
    coalesce(sum(w.i) filter (where w.cur), 0)::bigint,
    case when coalesce(sum(w.i) filter (where w.cur), 0) > 0
      then sum(w.pos * w.i) filter (where w.cur) / sum(w.i) filter (where w.cur) else null end,
    coalesce(sum(w.c) filter (where not w.cur), 0)::bigint,
    coalesce(sum(w.i) filter (where not w.cur), 0)::bigint,
    case when coalesce(sum(w.i) filter (where not w.cur), 0) > 0
      then sum(w.pos * w.i) filter (where not w.cur) / sum(w.i) filter (where not w.cur) else null end
  from w
  group by w.q, w.pg
  order by 4 desc, 7 desc, 1, 2
  limit greatest(1, least(coalesce(p_limit, 3000), 10000));
$$;

revoke all on function public.seo_gsc_keyword_pairs(integer, integer) from public, anon, authenticated;
grant execute on function public.seo_gsc_keyword_pairs(integer, integer) to service_role;

comment on function public.seo_gsc_keyword_pairs(integer, integer) is 'GSC sorgu x sayfa: guncel ve onceki esit pencere (son veri gunune gore). Yalniz service_role.';

