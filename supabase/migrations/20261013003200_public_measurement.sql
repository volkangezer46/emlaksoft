-- SP3: birinci taraf ölçüm (çerezsiz sayaç + gerçek kullanıcı hız ölçümü). Yalnız GÜNLÜK TOPLAM sayaçlar saklanır.
--
-- KVKK/gizlilik: IP, çerez, kullanıcı aracısı, tam referrer URL'si, sorgu dizesi, kullanıcı/ofis kimliği SAKLANMAZ.
--   Yol şablona çevrilmiş olarak (≤120; vitrin/ilan/danışman parçaları [ofis]/[ilan]/[kisi]) gelir; kaynak/ortam/kampanya
--   uygulamada temizlenir ve 32 karaktere kesilir. Tablo düzeyinde uzunluk/küme kısıtları ayrıca vardır.
-- Tenant verisi DEĞİLDİR (public sitenin sayaçları): RLS açık, politika yok, anon/authenticated için REVOKE;
--   yalnız service_role (RPC) erişir (seo_404_hits deseni).
-- analytics_ingest(p): SECURITY DEFINER, search_path boş, yalnız service_role. Toplu upsert: aynı anahtar bir partide
--   birden çok gelse bile önce toplanır (ON CONFLICT aynı satıra iki kez dokunmaz), n artırılır.
-- analytics_prune: sayfa sayaçları 400 gün, hız histogramı 90 gün (olcum-bakim cron'u günlük çağırır).
-- analytics_vitals_summary: Saha verisi ekranı için dönem histogramı (salt okunur, yalnız service_role).
-- KOD DAVRANIŞI: tablo/RPC yoksa beacon tamponu yazmayı 10 dk durdurur, sonra yeniden dener; site etkilenmez.
-- GERİ ALMA: supabase/rollbacks/20261013003200_public_measurement.rollback.sql (yalnız ölçüm sayaçları silinir).
-- RİSK: düşük (yeni iki tablo + iki fonksiyon; mevcut tablolara dokunmaz).

create table if not exists public.public_pageviews_daily (
  day date not null,
  path_tpl text not null check (char_length(path_tpl) between 1 and 120),
  channel text not null check (channel in (
    'paid_search','organic_search','social','referral_site','direct','email','office_invite','partner','vitrin_signature','unknown'
  )),
  source text not null default '' check (char_length(source) <= 32),
  medium text not null default '' check (char_length(medium) <= 32),
  campaign text not null default '' check (char_length(campaign) <= 32),
  device text not null check (device in ('mobile','desktop')),
  n integer not null default 0 check (n >= 0),
  primary key (day, path_tpl, channel, source, medium, campaign, device)
);

create table if not exists public.web_vitals_daily (
  day date not null,
  path_tpl text not null check (char_length(path_tpl) between 1 and 120),
  device text not null check (device in ('mobile','desktop')),
  metric text not null check (metric in ('LCP','INP','CLS','FCP','TTFB')),
  bucket smallint not null check (bucket between 0 and 31),
  static boolean not null default false,
  n integer not null default 0 check (n >= 0),
  primary key (day, path_tpl, device, metric, bucket, static)
);

alter table public.public_pageviews_daily enable row level security;
alter table public.web_vitals_daily enable row level security;
-- Politika bilerek yok: anon/authenticated hiçbir şey göremez; service_role RLS'i atlar.
revoke all on public.public_pageviews_daily from anon, authenticated;
revoke all on public.web_vitals_daily from anon, authenticated;
grant select, insert, update, delete on public.public_pageviews_daily to service_role;
grant select, insert, update, delete on public.web_vitals_daily to service_role;

create or replace function public.analytics_ingest(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pv integer := 0;
  v_wv integer := 0;
  v_min date := (now() at time zone 'Europe/Istanbul')::date - 3;
  v_max date := (now() at time zone 'Europe/Istanbul')::date + 1;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('pv', 0, 'wv', 0);
  end if;

  with raw as (
    select e
    from jsonb_array_elements(case when jsonb_typeof(p->'pv') = 'array' then p->'pv' else '[]'::jsonb end) e
    where jsonb_typeof(e) = 'object'
      and coalesce(e->>'day', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(e->>'n', '') ~ '^\d{1,7}$'
  ), rows as (
    select case when (e->>'day') ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (e->>'day')::date end as day,
           left(coalesce(e->>'path_tpl', ''), 120) as path_tpl,
           coalesce(e->>'channel', '') as channel,
           left(coalesce(e->>'source', ''), 32) as source,
           left(coalesce(e->>'medium', ''), 32) as medium,
           left(coalesce(e->>'campaign', ''), 32) as campaign,
           coalesce(e->>'device', '') as device,
           least((e->>'n')::integer, 1000000) as n
    from raw
  ), agg as (
    select day, path_tpl, channel, source, medium, campaign, device, sum(n)::integer as n
    from rows
    where day between v_min and v_max
      and char_length(path_tpl) between 1 and 120
      and channel in ('paid_search','organic_search','social','referral_site','direct','email','office_invite','partner','vitrin_signature','unknown')
      and device in ('mobile','desktop')
      and n > 0
    group by 1, 2, 3, 4, 5, 6, 7
  ), ins as (
    insert into public.public_pageviews_daily as t (day, path_tpl, channel, source, medium, campaign, device, n)
    select day, path_tpl, channel, source, medium, campaign, device, n from agg
    on conflict (day, path_tpl, channel, source, medium, campaign, device) do update set n = t.n + excluded.n
    returning 1
  )
  select count(*)::integer into v_pv from ins;

  with raw as (
    select e
    from jsonb_array_elements(case when jsonb_typeof(p->'wv') = 'array' then p->'wv' else '[]'::jsonb end) e
    where jsonb_typeof(e) = 'object'
      and coalesce(e->>'day', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(e->>'n', '') ~ '^\d{1,7}$'
      and coalesce(e->>'bucket', '') ~ '^\d{1,2}$'
  ), rows as (
    select case when (e->>'day') ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then (e->>'day')::date end as day,
           left(coalesce(e->>'path_tpl', ''), 120) as path_tpl,
           coalesce(e->>'device', '') as device,
           coalesce(e->>'metric', '') as metric,
           (e->>'bucket')::smallint as bucket,
           coalesce(e->>'static', 'false') = 'true' as static,
           least((e->>'n')::integer, 1000000) as n
    from raw
  ), agg as (
    select day, path_tpl, device, metric, bucket, static, sum(n)::integer as n
    from rows
    where day between v_min and v_max
      and char_length(path_tpl) between 1 and 120
      and device in ('mobile','desktop')
      and metric in ('LCP','INP','CLS','FCP','TTFB')
      and bucket between 0 and 31
      and n > 0
    group by 1, 2, 3, 4, 5, 6
  ), ins as (
    insert into public.web_vitals_daily as t (day, path_tpl, device, metric, bucket, static, n)
    select day, path_tpl, device, metric, bucket, static, n from agg
    on conflict (day, path_tpl, device, metric, bucket, static) do update set n = t.n + excluded.n
    returning 1
  )
  select count(*)::integer into v_wv from ins;

  return jsonb_build_object('pv', v_pv, 'wv', v_wv);
end;
$$;

create or replace function public.analytics_prune(p_pageview_days integer default 400, p_vitals_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_pv integer := 0;
  v_wv integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.public_pageviews_daily where day < v_today - greatest(coalesce(p_pageview_days, 400), 30);
  get diagnostics v_pv = row_count;
  delete from public.web_vitals_daily where day < v_today - greatest(coalesce(p_vitals_days, 90), 7);
  get diagnostics v_wv = row_count;
  return jsonb_build_object('pv', v_pv, 'wv', v_wv);
end;
$$;

-- Saha verisi ekranı: dönem histogramı (gün toplamı SQL'de; p75 uygulamada histogramdan hesaplanır). En çok 200 yol
-- şablonu (örnek sayısına göre) + site geneli; yanıt boyutu sınırlı kalır. Salt okunur, yalnız service_role.
create or replace function public.analytics_vitals_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  with top as (
    select w.path_tpl
    from public.web_vitals_daily w
    where w.day between p_from and p_to
    group by w.path_tpl
    order by sum(w.n) desc, w.path_tpl
    limit 200
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'path_tpl', h.path_tpl, 'device', h.device, 'metric', h.metric, 'bucket', h.bucket, 'static', h.static, 'n', h.n
         )), '[]'::jsonb)
  into v_result
  from (
    select w.path_tpl, w.device, w.metric, w.bucket, w.static, sum(w.n)::bigint as n
    from public.web_vitals_daily w
    join top t on t.path_tpl = w.path_tpl
    where w.day between p_from and p_to
    group by 1, 2, 3, 4, 5
  ) h;
  return v_result;
end;
$$;

revoke all on function public.analytics_ingest(jsonb) from public, anon, authenticated;
revoke all on function public.analytics_prune(integer, integer) from public, anon, authenticated;
revoke all on function public.analytics_vitals_summary(date, date) from public, anon, authenticated;
grant execute on function public.analytics_ingest(jsonb) to service_role;
grant execute on function public.analytics_prune(integer, integer) to service_role;
grant execute on function public.analytics_vitals_summary(date, date) to service_role;

comment on table public.public_pageviews_daily is 'Birinci taraf sayaç: gün x şablon yol x kanal x kaynak/ortam/kampanya x cihaz (IP/çerez/sorgu yok).';
comment on table public.web_vitals_daily is 'Gerçek kullanıcı hız ölçümü histogramı: gün x şablon yol x cihaz x metrik x kova x statik (ham değer yok).';

notify pgrst, 'reload schema';
