-- Google baglanti merkezi (SP5): Search Console performansi, URL Inspection sonuclari, Google Ads gunluk metrikleri.
--
-- Tenant verisi DEGILDIR (platformun kendi sitesi ve reklam hesabi): RLS acik, politika YOK, anon/authenticated
--   icin REVOKE -> yalniz service_role erisir (seo_404_hits deseni). Kisisel veri saklanmaz (GSC sorgulari Google'in
--   anonimlestirdigi arama ifadeleridir; Ads satirlari kampanya/reklam grubu toplamlari).
-- Yazan: google-senkron cron'u (03:10 UTC). Okuyan: /admin/seo/performans, /admin/site/reklam/google (sunucu, service_role).
-- seo_gsc_daily: query = '' satirlari SAYFA TOPLAMIDIR (date+page+device boyutlariyla ayri cekilir); Google nadir
--   sorgulari gizledigi icin sorgu satirlarinin toplami sayfa toplamindan kucuktur.
-- Saklama: GSC 16 ay, Ads 25 ay; budama google_data_prune() ile cron'da.
-- Baglanti/belirtec kayitlari platform_settings 'google.*' anahtarlarindadir (uygulama katmaninda muhurlu); bu dosya
--   platform_settings'e dokunmaz.
-- KOD DAVRANISI: tablolar yokken ekranlar "bagli degil"/"veri yok" gosterir, cron adimi hatayi satir notuna yazar.
-- GERI ALMA: supabase/rollbacks/20261013003400_google_data.rollback.sql. RISK: dusuk (yeni tablolar + bir fonksiyon).

create table if not exists public.seo_gsc_daily (
  day date not null,
  page text not null check (char_length(page) between 1 and 2000),
  query text not null default '' check (char_length(query) <= 500),
  device text not null check (char_length(device) between 1 and 16),
  clicks integer not null default 0 check (clicks >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  ctr double precision not null default 0,
  position double precision not null default 0,
  primary key (day, page, query, device)
);

create index if not exists seo_gsc_daily_query_day_idx on public.seo_gsc_daily (query, day);

create table if not exists public.seo_url_inspections (
  url text primary key check (char_length(url) between 1 and 2000),
  checked_at timestamptz not null default now(),
  verdict text not null check (char_length(verdict) <= 40),
  coverage text check (coverage is null or char_length(coverage) <= 200),
  google_canonical text check (google_canonical is null or char_length(google_canonical) <= 2000),
  user_canonical text check (user_canonical is null or char_length(user_canonical) <= 2000)
);

create index if not exists seo_url_inspections_checked_idx on public.seo_url_inspections (checked_at);

create table if not exists public.ads_daily_metrics (
  day date not null,
  campaign_id text not null check (char_length(campaign_id) between 1 and 32),
  campaign text not null default '' check (char_length(campaign) <= 300),
  ad_group_id text not null check (char_length(ad_group_id) between 1 and 32),
  ad_group text not null default '' check (char_length(ad_group) <= 300),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  conversions double precision not null default 0 check (conversions >= 0),
  conv_value double precision not null default 0 check (conv_value >= 0),
  -- Kampanya o gun butce kisitli miydi (campaign.primary_status_reasons BUDGET_CONSTRAINED); kural onerisi icin.
  budget_limited boolean not null default false,
  primary key (day, campaign_id, ad_group_id)
);

alter table public.seo_gsc_daily enable row level security;
alter table public.seo_url_inspections enable row level security;
alter table public.ads_daily_metrics enable row level security;
-- Politika bilerek yok: anon/authenticated hicbir sey goremez; service_role RLS'i atlar.
revoke all on public.seo_gsc_daily from public, anon, authenticated;
revoke all on public.seo_url_inspections from public, anon, authenticated;
revoke all on public.ads_daily_metrics from public, anon, authenticated;
grant select, insert, update, delete on public.seo_gsc_daily to service_role;
grant select, insert, update, delete on public.seo_url_inspections to service_role;
grant select, insert, update, delete on public.ads_daily_metrics to service_role;

-- Budama: GSC 16 ay, Ads 25 ay; sitemap'ten dusmus ve 180 gundur incelenmemis URL sonuclari. Silinen satir sayisini doner.
create or replace function public.google_data_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
  step integer := 0;
begin
  delete from public.seo_gsc_daily where day < (pg_catalog.now() - interval '16 months')::date;
  get diagnostics step = row_count;
  removed := removed + step;

  delete from public.ads_daily_metrics where day < (pg_catalog.now() - interval '25 months')::date;
  get diagnostics step = row_count;
  removed := removed + step;

  delete from public.seo_url_inspections where checked_at < pg_catalog.now() - interval '180 days';
  get diagnostics step = row_count;
  return removed + step;
end;
$$;

revoke all on function public.google_data_prune() from public, anon, authenticated;
grant execute on function public.google_data_prune() to service_role;

-- Ekran ozeti: son p_days gunde sorgu (p_kind='query') ya da sayfa (p_kind='page', query='' satirlari) bazinda toplam.
-- Pozisyon gosterim agirlikli ortalamadir; CTR = tiklama / gosterim. Satir sayisi p_limit ile sinirli (en cok 500).
create or replace function public.seo_gsc_summary(p_days integer, p_kind text, p_limit integer default 100)
returns table (key text, clicks bigint, impressions bigint, ctr double precision, avg_position double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when p_kind = 'query' then g.query else g.page end as key,
    sum(g.clicks)::bigint as clicks,
    sum(g.impressions)::bigint as impressions,
    case when sum(g.impressions) > 0 then sum(g.clicks)::double precision / sum(g.impressions) else 0 end as ctr,
    case when sum(g.impressions) > 0 then sum(g.position * g.impressions) / sum(g.impressions) else 0 end as avg_position
  from public.seo_gsc_daily g
  where g.day >= (pg_catalog.now() - pg_catalog.make_interval(days => greatest(1, least(coalesce(p_days, 28), 500))))::date
    and ((p_kind = 'query' and g.query <> '') or (p_kind <> 'query' and g.query = ''))
  group by 1
  order by sum(g.clicks) desc, sum(g.impressions) desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on function public.seo_gsc_summary(integer, text, integer) from public, anon, authenticated;
grant execute on function public.seo_gsc_summary(integer, text, integer) to service_role;

comment on table public.seo_gsc_daily is 'Search Console gunluk performans (query = '''' satirlari sayfa toplami). Yalniz service_role.';
comment on table public.seo_url_inspections is 'URL Inspection son sonuclari (gunde en cok 50 URL). Yalniz service_role.';
comment on table public.ads_daily_metrics is 'Google Ads gunluk kampanya/reklam grubu metrikleri (yalniz okuma). Yalniz service_role.';

notify pgrst, 'reload schema';
