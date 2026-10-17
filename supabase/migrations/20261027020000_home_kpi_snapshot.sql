-- MIGRATION 20261027020000_home_kpi_snapshot.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261027020000_home_kpi_snapshot.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261027020000_home_kpi_snapshot.rollback.sql
-- BAGIMLILIK: public.customers, public.deals, public.customer_demands, public.calls (is_sample sutunlari),
--   deals.closed_at, public.current_tenant_id().
--
-- AMAC (PKG-2 PERF-2/PERF-9, F3): ana ekran KPI satiri (loadKpiData / loadRoleKpis) musteri, anlasma, talep ve gelen arama
--   icin ayri ayri head sayimi + 600 satirlik tarih listesi (12 haftalik kova JS'te) cekiyordu: tek KPI satiri = 12+ PostgREST
--   turu. Satis performansi (loadSalesPerformance) 1000 kazanilmis anlasma satirini JS'te topluyordu. Iki INVOKER RPC:
--   * home_kpi_snapshot(p_scope, p_since, p_include_sample, p_now): her varlik icin bu ay / gecen ayin es donemi sayimi +
--     haftalik kovalar (JS weekBuckets ile AYNI formul: idx = hafta-1 - floor((p_now - t) / 7 gun)) + acik anlasma sayisi +
--     musteri TOPLAMI (F3: "Musterilerim" toplami ve "Bu ay N yeni" ayni sorgudan, ayni kapsamla).
--   * home_sales_windows(p_scope, p_since, p_windows, p_include_sample, p_deal_type, p_advisor): kazanilmis anlasmalarin
--     verilen [a, b) pencerelerine (epoch ms; JS salesWindow/salesSeries pencereleri) toplam/adet/sure toplami.
--   Kod RPC yoksa/hata verirse eski sorgulara duser (rpc-probe deseni); sahte sifir uretilmez.
--
-- GUVENLIK: SECURITY INVOKER (RLS cagiranin yetkisiyle: yetkisiz tablo satir vermez). Oturum ya da ofis yoksa NULL.
--   'ben' kapsami yalniz auth.uid()'e atanmis kayitlar; baska kullanici icin parametre ALINMAZ (p_advisor yalniz 'ofis'
--   kapsaminda, zaten RLS ile gorulen satirlari daraltir).
-- ORNEK VERI KURALI: karar kodda TEK yerde (lib/sample-scope, ctx.sample.include) verilir ve p_include_sample ile gelir:
--   false -> is_sample = false suzgeci (JS ctx.sample.apply ile birebir). Parametre RLS'i genisletmez, yalniz daraltir.
-- ZAMAN: ay sinirlari Europe/Istanbul (src/lib/clock.ts TR_OFFSET_MS ile ayni; Turkiye'de yaz saati yok).
-- ETKI: yalniz 2 yeni fonksiyon (ek). Tablo/politika/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.customers') is null or pg_catalog.to_regclass('public.deals') is null
     or pg_catalog.to_regclass('public.customer_demands') is null or pg_catalog.to_regclass('public.calls') is null then
    raise exception 'ana ekran KPI tablolarindan biri yok (customers/deals/customer_demands/calls).';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
end $$;

-- Haftalik kova (saf; JS weekBuckets ile ayni): idx = n-1 - floor((now - t) / 7 gun), 0..n-1 disi atlanir.
create or replace function public.home_kpi_week_buckets(p_dates timestamptz[], p_now timestamptz, p_weeks integer)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(coalesce(b.n, 0) order by g.i), '[]'::jsonb)
  from generate_series(0, greatest(p_weeks, 1) - 1) as g(i)
  left join (
    select (p_weeks - 1 - floor(extract(epoch from (p_now - d)) * 1000 / 604800000.0))::integer as i, count(*) as n
    from unnest(coalesce(p_dates, '{}'::timestamptz[])) as d
    group by 1
  ) b on b.i = g.i;
$$;

create or replace function public.home_kpi_snapshot(
  p_scope text,
  p_since timestamptz,
  p_include_sample boolean,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_mine boolean := (p_scope = 'ben');
  v_tr timestamp := p_now at time zone 'Europe/Istanbul';
  v_month_start timestamptz;
  v_prev_start timestamptz;
  v_prev_same timestamptz;
  v_weeks integer;
  v_customers jsonb;
  v_deals jsonb;
  v_demands jsonb;
  v_calls jsonb;
begin
  if v_uid is null or v_tenant is null or p_scope not in ('ben', 'ofis') or p_since is null or p_now is null then
    return null;
  end if;
  v_month_start := date_trunc('month', v_tr) at time zone 'Europe/Istanbul';
  v_prev_start := (date_trunc('month', v_tr) - interval '1 month') at time zone 'Europe/Istanbul';
  -- Adil karsilastirma: gecen ayin ilk N gunu (JS: min(monthStart, prevStart + (now - monthStart))).
  v_prev_same := least(v_month_start, v_prev_start + (p_now - v_month_start));
  v_weeks := greatest(1, least(104, round(extract(epoch from (p_now - p_since)) / 604800.0)::integer));

  -- Musteri: TEK gecis (toplam + bu ay + gecen ayin es donemi + haftalik kovalar).
  with base as (
    select c.created_at as t
    from public.customers c
    where c.tenant_id = v_tenant and c.deleted_at is null
      and (not v_mine or c.assigned_to = v_uid)
      and (p_include_sample or c.is_sample = false)
  )
  select jsonb_build_object(
    'total', count(*),
    'this_month', count(*) filter (where t >= v_month_start),
    'prev_month', count(*) filter (where t >= v_prev_start and t < v_prev_same),
    'weekly', public.home_kpi_week_buckets(array_agg(t) filter (where t >= p_since), p_now, v_weeks)
  ) into v_customers from base;

  with base as (
    select d.created_at as t, d.stage
    from public.deals d
    where d.tenant_id = v_tenant
      and (not v_mine or d.assigned_to = v_uid)
      and (p_include_sample or d.is_sample = false)
  )
  select jsonb_build_object(
    'total', count(*),
    'open', count(*) filter (where stage is not null and stage not in ('won', 'lost')),
    'this_month', count(*) filter (where t >= v_month_start),
    'prev_month', count(*) filter (where t >= v_prev_start and t < v_prev_same),
    'weekly', public.home_kpi_week_buckets(array_agg(t) filter (where t >= p_since), p_now, v_weeks)
  ) into v_deals from base;

  -- Talep: son 30 gun <-> onceki 30 gun (talep listesinin ?eklenen=30 suzgeciyle ayni kume); kisi baglantisi musterinin
  -- danismani uzerinden (talep satirinda atama yok).
  with base as (
    select dm.created_at as t
    from public.customer_demands dm
    where dm.tenant_id = v_tenant
      and (p_include_sample or dm.is_sample = false)
      and (not v_mine or exists (
        select 1 from public.customers oc where oc.id = dm.customer_id and oc.assigned_to = v_uid
      ))
  )
  select jsonb_build_object(
    'total', count(*),
    'this_month', count(*) filter (where t >= p_now - interval '30 days'),
    'prev_month', count(*) filter (where t >= p_now - interval '60 days' and t < p_now - interval '30 days'),
    'weekly', public.home_kpi_week_buckets(array_agg(t) filter (where t >= p_since), p_now, v_weeks)
  ) into v_demands from base;

  with base as (
    select k.started_at as t
    from public.calls k
    where k.tenant_id = v_tenant and k.direction = 'inbound'
      and (not v_mine or k.handled_by = v_uid)
      and (p_include_sample or k.is_sample = false)
  )
  select jsonb_build_object(
    'total', count(*),
    'this_month', count(*) filter (where t >= v_month_start),
    'prev_month', count(*) filter (where t >= v_prev_start and t < v_prev_same),
    'weekly', public.home_kpi_week_buckets(array_agg(t) filter (where t >= p_since), p_now, v_weeks)
  ) into v_calls from base;

  return jsonb_build_object(
    'version', 1,
    'scope', p_scope,
    'sample_included', p_include_sample,
    'weeks', v_weeks,
    'customers', v_customers,
    'deals', v_deals,
    'demands', v_demands,
    'calls', v_calls
  );
end;
$$;

create or replace function public.home_sales_windows(
  p_scope text,
  p_since timestamptz,
  p_windows jsonb,
  p_include_sample boolean,
  p_deal_type text default null,
  p_advisor uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_mine boolean := (p_scope = 'ben');
  v_out jsonb;
begin
  if v_uid is null or v_tenant is null or p_scope not in ('ben', 'ofis') or p_since is null
     or p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 64 then
    return null;
  end if;
  with won as (
    select coalesce(d.deal_value, 0)::numeric as v,
           d.created_at,
           coalesce(d.closed_at, d.updated_at) as closed
    from public.deals d
    where d.tenant_id = v_tenant and d.stage = 'won' and d.updated_at >= p_since
      and (p_include_sample or d.is_sample = false)
      and (case when v_mine then d.assigned_to = v_uid when p_advisor is not null then d.assigned_to = p_advisor else true end)
      and (p_deal_type is null or d.deal_type = p_deal_type)
  ),
  win as (
    select w.ord,
           to_timestamp(((w.val ->> 0)::numeric) / 1000.0) as a,
           to_timestamp(((w.val ->> 1)::numeric) / 1000.0) as b
    from jsonb_array_elements(p_windows) with ordinality as w(val, ord)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sum', coalesce(s.total, 0),
           'count', coalesce(s.n, 0),
           'dur_days', coalesce(s.dur_days, 0),
           'dur_n', coalesce(s.dur_n, 0)
         ) order by win.ord), '[]'::jsonb)
  into v_out
  from win
  left join lateral (
    select sum(won.v) as total,
           count(*) as n,
           sum(extract(epoch from (won.closed - won.created_at)) / 86400.0) filter (where won.created_at is not null and won.closed > won.created_at) as dur_days,
           count(*) filter (where won.created_at is not null and won.closed > won.created_at) as dur_n
    from won
    where won.closed >= win.a and won.closed < win.b
  ) s on true;
  return jsonb_build_object('version', 1, 'scope', p_scope, 'sample_included', p_include_sample, 'windows', v_out);
end;
$$;

comment on function public.home_kpi_snapshot(text, timestamptz, boolean, timestamptz) is
  'Ana ekran KPI satiri tek JSON: musteri/anlasma/talep/gelen arama bu ay + gecen ayin es donemi + haftalik kovalar + acik anlasma + musteri toplami. SECURITY INVOKER; p_scope ben|ofis.';
comment on function public.home_kpi_week_buckets(timestamptz[], timestamptz, integer) is
  'Saf yardimci: tarih dizisini son p_weeks haftalik kovaya sayar (JS weekBuckets ile ayni).';
comment on function public.home_sales_windows(text, timestamptz, jsonb, boolean, text, uuid) is
  'Ana ekran satis performansi: kazanilmis anlasmalarin verilen [a,b) epoch-ms pencerelerine toplam/adet/sure toplami. SECURITY INVOKER.';

revoke all on function public.home_kpi_snapshot(text, timestamptz, boolean, timestamptz) from public, anon;
revoke all on function public.home_kpi_week_buckets(timestamptz[], timestamptz, integer) from public, anon;
revoke all on function public.home_sales_windows(text, timestamptz, jsonb, boolean, text, uuid) from public, anon;
grant execute on function public.home_kpi_snapshot(text, timestamptz, boolean, timestamptz) to authenticated, service_role;
grant execute on function public.home_kpi_week_buckets(timestamptz[], timestamptz, integer) to authenticated, service_role;
grant execute on function public.home_sales_windows(text, timestamptz, jsonb, boolean, text, uuid) to authenticated, service_role;
