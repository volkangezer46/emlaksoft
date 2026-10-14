-- MIGRATION 20261015013000_metrics_snapshot_single_pass.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi:
--   scripts/db-shadow-replay.sh + supabase/tests/kq2_metrics_snapshot.test.sql eski/yeni anahtar anahtar karsilastirma).
-- Geri alma: supabase/rollbacks/20261015013000_metrics_snapshot_single_pass.rollback.sql (20261006000410 govdesi birebir).
-- BAGIMLILIK: 20261006000410_dashboard_snapshot_rpcs.sql (get_metrics_snapshot ilk tanim + ACL).
--
-- AMAC (KQ2, ana ekran): eski govde customers'i 11, customer_demands'i 9, calls'u 2, properties'i 2 kez ayri ayri sayiyordu
--   (her biri ayri tarama + her taramada RLS). Yeni govde tablo basina TEK gecis yapar: tum sayaclar `count(*) FILTER`
--   ile ayni taramada hesaplanir. Ornek veri kurali (gercek musteri VE portfoy < 5 ise ornek dahil) sayaclardan ONCE
--   bilinmedigi icin her sayac iki bicimde (ornek dahil / yalniz gercek) ayni taramada sayilir, sonra secilir.
-- CIKTI SOZLESMESI DEGISMEZ: anahtarlar, tipler (bigint sayaclar, jsonb tarih dizileri), siralar, sinirlar (100/500/12),
--   zaman sinirlari (Europe/Istanbul gun/ay, v_now - N gun) birebir ayni. Tarih dizileri (call_dates, customer_dates,
--   customer_dates_90, demand_dates_90) ve karar/yetki bolumleri zaten tek sorgudur, aynen kalir.
-- GUVENLIK DEGISMEZ: SECURITY INVOKER (RLS cagiranin yetkisiyle), kimlik/kiraci kapisi ayni; ACL korunur (CREATE OR REPLACE).
set local lock_timeout = '5s';

create or replace function public.get_metrics_snapshot(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_tr_now timestamp;
  v_day_start timestamptz;
  v_yesterday_start timestamptz;
  v_month_start timestamptz;
  v_prev_month_start timestamptz;
  v_today date;
  v_include boolean;
  cu record;
  pr record;
  ca record;
  de record;
  v_kpi jsonb;
  v_demands jsonb;
  v_period jsonb;
  v_decisions jsonb;
  v_authority jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_user_id is null
     or p_tenant_id is distinct from public.current_tenant_id() or p_user_id is distinct from v_uid then
    return null;
  end if;

  v_tr_now := v_now at time zone 'Europe/Istanbul';
  v_day_start := date_trunc('day', v_tr_now) at time zone 'Europe/Istanbul';
  v_yesterday_start := v_day_start - interval '1 day';
  v_month_start := date_trunc('month', v_tr_now) at time zone 'Europe/Istanbul';
  v_prev_month_start := (date_trunc('month', v_tr_now) - interval '1 month') at time zone 'Europe/Istanbul';
  v_today := v_tr_now::date;

  -- customers: TEK gecis. a_* = ornek dahil, r_* = yalniz gercek (is_sample = false).
  select
    count(*) as a_total,
    count(*) filter (where c.is_sample = false) as r_total,
    count(*) filter (where c.created_at >= v_month_start) as a_m,
    count(*) filter (where c.created_at >= v_month_start and c.is_sample = false) as r_m,
    count(*) filter (where c.created_at >= v_prev_month_start and c.created_at < v_month_start) as a_pm,
    count(*) filter (where c.created_at >= v_prev_month_start and c.created_at < v_month_start and c.is_sample = false) as r_pm,
    count(*) filter (where c.created_at >= v_now - interval '7 days') as a_7,
    count(*) filter (where c.created_at >= v_now - interval '7 days' and c.is_sample = false) as r_7,
    count(*) filter (where c.created_at >= v_now - interval '14 days' and c.created_at < v_now - interval '7 days') as a_7p,
    count(*) filter (where c.created_at >= v_now - interval '14 days' and c.created_at < v_now - interval '7 days' and c.is_sample = false) as r_7p,
    count(*) filter (where c.created_at >= v_now - interval '30 days') as a_30,
    count(*) filter (where c.created_at >= v_now - interval '30 days' and c.is_sample = false) as r_30,
    count(*) filter (where c.created_at >= v_now - interval '60 days' and c.created_at < v_now - interval '30 days') as a_30p,
    count(*) filter (where c.created_at >= v_now - interval '60 days' and c.created_at < v_now - interval '30 days' and c.is_sample = false) as r_30p,
    count(*) filter (where c.created_at >= v_now - interval '90 days') as a_90,
    count(*) filter (where c.created_at >= v_now - interval '90 days' and c.is_sample = false) as r_90,
    count(*) filter (where c.created_at >= v_now - interval '180 days' and c.created_at < v_now - interval '90 days') as a_90p,
    count(*) filter (where c.created_at >= v_now - interval '180 days' and c.created_at < v_now - interval '90 days' and c.is_sample = false) as r_90p
  into cu
  from public.customers c
  where c.tenant_id = p_tenant_id and c.deleted_at is null;

  -- properties: TEK gecis.
  select
    count(*) as a_total,
    count(*) filter (where p.is_sample = false) as r_total
  into pr
  from public.properties p
  where p.tenant_id = p_tenant_id and p.deleted_at is null;

  v_include := (cu.r_total < 5 and pr.r_total < 5);

  -- calls: TEK gecis (dun basindan itibaren).
  select
    count(*) filter (where k.started_at >= v_day_start) as a_today,
    count(*) filter (where k.started_at >= v_day_start and k.is_sample = false) as r_today,
    count(*) filter (where k.started_at < v_day_start) as a_yday,
    count(*) filter (where k.started_at < v_day_start and k.is_sample = false) as r_yday
  into ca
  from public.calls k
  where k.tenant_id = p_tenant_id and k.started_at >= v_yesterday_start;

  -- customer_demands: TEK gecis (durum sayaclari + 7/30/90 donem sayaclari).
  select
    count(*) filter (where d.status = 'new') as a_new,
    count(*) filter (where d.status = 'new' and d.is_sample = false) as r_new,
    count(*) filter (where d.status = 'active') as a_active,
    count(*) filter (where d.status = 'active' and d.is_sample = false) as r_active,
    count(*) filter (where d.status = 'matched') as a_matched,
    count(*) filter (where d.status = 'matched' and d.is_sample = false) as r_matched,
    count(*) filter (where d.created_at >= v_now - interval '7 days') as a_7,
    count(*) filter (where d.created_at >= v_now - interval '7 days' and d.is_sample = false) as r_7,
    count(*) filter (where d.created_at >= v_now - interval '14 days' and d.created_at < v_now - interval '7 days') as a_7p,
    count(*) filter (where d.created_at >= v_now - interval '14 days' and d.created_at < v_now - interval '7 days' and d.is_sample = false) as r_7p,
    count(*) filter (where d.created_at >= v_now - interval '30 days') as a_30,
    count(*) filter (where d.created_at >= v_now - interval '30 days' and d.is_sample = false) as r_30,
    count(*) filter (where d.created_at >= v_now - interval '60 days' and d.created_at < v_now - interval '30 days') as a_30p,
    count(*) filter (where d.created_at >= v_now - interval '60 days' and d.created_at < v_now - interval '30 days' and d.is_sample = false) as r_30p,
    count(*) filter (where d.created_at >= v_now - interval '90 days') as a_90,
    count(*) filter (where d.created_at >= v_now - interval '90 days' and d.is_sample = false) as r_90,
    count(*) filter (where d.created_at >= v_now - interval '180 days' and d.created_at < v_now - interval '90 days') as a_90p,
    count(*) filter (where d.created_at >= v_now - interval '180 days' and d.created_at < v_now - interval '90 days' and d.is_sample = false) as r_90p
  into de
  from public.customer_demands d
  where d.tenant_id = p_tenant_id;

  -- KPI sayaclari (loadKpiCounts ile ayni tanimlar)
  select jsonb_build_object(
    'customer_count', case when v_include then cu.a_total else cu.r_total end,
    'property_count', case when v_include then pr.a_total else pr.r_total end,
    'calls_today', case when v_include then ca.a_today else ca.r_today end,
    'calls_yesterday', case when v_include then ca.a_yday else ca.r_yday end,
    'customers_this_month', case when v_include then cu.a_m else cu.r_m end,
    'customers_prev_month', case when v_include then cu.a_pm else cu.r_pm end,
    'call_dates', coalesce((
      select jsonb_agg(d.started_at order by d.started_at desc) from (
        select k.started_at from public.calls k
        where k.tenant_id = p_tenant_id and k.started_at >= v_now - interval '49 days' and (v_include or k.is_sample = false)
        order by k.started_at desc limit 100
      ) d
    ), '[]'::jsonb),
    'customer_dates', coalesce((
      select jsonb_agg(d.created_at order by d.created_at desc) from (
        select c.created_at from public.customers c
        where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_now - interval '49 days' and (v_include or c.is_sample = false)
        order by c.created_at desc limit 100
      ) d
    ), '[]'::jsonb)
  ) into v_kpi;

  -- Talep durum sayaclari (loadDemandCounts)
  v_demands := jsonb_build_object(
    'new', case when v_include then de.a_new else de.r_new end,
    'active', case when v_include then de.a_active else de.r_active end,
    'matched', case when v_include then de.a_matched else de.r_matched end
  );

  -- Donem istatistikleri 7/30/90 (loadPeriodStats): sayaclar + 90 gunluk tarih serisi (500 siniri)
  select jsonb_build_object(
    'p7', jsonb_build_object(
      'customers', case when v_include then cu.a_7 else cu.r_7 end,
      'customers_prev', case when v_include then cu.a_7p else cu.r_7p end,
      'demands', case when v_include then de.a_7 else de.r_7 end,
      'demands_prev', case when v_include then de.a_7p else de.r_7p end
    ),
    'p30', jsonb_build_object(
      'customers', case when v_include then cu.a_30 else cu.r_30 end,
      'customers_prev', case when v_include then cu.a_30p else cu.r_30p end,
      'demands', case when v_include then de.a_30 else de.r_30 end,
      'demands_prev', case when v_include then de.a_30p else de.r_30p end
    ),
    'p90', jsonb_build_object(
      'customers', case when v_include then cu.a_90 else cu.r_90 end,
      'customers_prev', case when v_include then cu.a_90p else cu.r_90p end,
      'demands', case when v_include then de.a_90 else de.r_90 end,
      'demands_prev', case when v_include then de.a_90p else de.r_90p end
    ),
    'customer_dates_90', coalesce((
      select jsonb_agg(x.created_at order by x.created_at desc) from (
        select c.created_at from public.customers c
        where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_now - interval '90 days' and (v_include or c.is_sample = false)
        order by c.created_at desc limit 500
      ) x
    ), '[]'::jsonb),
    'demand_dates_90', coalesce((
      select jsonb_agg(x.created_at order by x.created_at desc) from (
        select d.created_at from public.customer_demands d
        where d.tenant_id = p_tenant_id and d.created_at >= v_now - interval '90 days' and (v_include or d.is_sample = false)
        order by d.created_at desc limit 500
      ) x
    ), '[]'::jsonb)
  ) into v_period;

  -- Karar bekleyenler (loadDecisions): sayaclar RLS'in verdigi satirlardan; gosterim kapilari kodda.
  select jsonb_build_object(
    'approvals_pending', (
      select count(*) from public.approval_requests a
      where a.tenant_id = p_tenant_id and a.status = 'bekliyor' and a.requested_by is distinct from v_uid
    ),
    'lost_this_month', (
      select coalesce(sum(l.estimated_lost_commission), 0) from public.listing_closures l
      where l.tenant_id = p_tenant_id and l.created_at >= v_month_start
    ),
    'overdue_rent', (select count(*) from public.rent_charges r where r.tenant_id = p_tenant_id and r.status = 'overdue'),
    'passive_days', 30,
    'passive_advisors', (
      select count(*) from public.profiles a
      where a.tenant_id = p_tenant_id and a.is_active and a.role in ('advisor', 'team_lead')
        and a.created_at < v_now - interval '30 days'
        and not exists (
          select 1 from public.deals d
          where d.tenant_id = p_tenant_id and d.assigned_to = a.id and d.updated_at >= v_now - interval '30 days'
            and (v_include or d.is_sample = false)
        )
    )
  ) into v_decisions;

  -- Yetki belgesi 15 gun icinde bitecek yayindaki portfoyler (loadExpiringAuthority): ben / ofis, en cok 12
  select jsonb_build_object(
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'property_code', x.property_code, 'title', x.title, 'authorization_end', x.authorization_end) order by x.authorization_end asc)
      from (
        select p.id, p.property_code, p.title, p.authorization_end from public.properties p
        where p.tenant_id = p_tenant_id and p.status = 'live' and p.deleted_at is null and p.authorization_end is not null
          and p.authorization_end >= v_today and p.authorization_end <= v_today + 15 and p.assigned_to = v_uid
        order by p.authorization_end asc limit 12
      ) x
    ), '[]'::jsonb),
    'office', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'property_code', x.property_code, 'title', x.title, 'authorization_end', x.authorization_end) order by x.authorization_end asc)
      from (
        select p.id, p.property_code, p.title, p.authorization_end from public.properties p
        where p.tenant_id = p_tenant_id and p.status = 'live' and p.deleted_at is null and p.authorization_end is not null
          and p.authorization_end >= v_today and p.authorization_end <= v_today + 15
        order by p.authorization_end asc limit 12
      ) x
    ), '[]'::jsonb)
  ) into v_authority;

  return jsonb_build_object(
    'version', 1,
    'computed_at', v_now,
    'sample_included', v_include,
    'kpi', v_kpi,
    'demands', v_demands,
    'period', v_period,
    'decisions', v_decisions,
    'expiring_authority', v_authority
  );
end;
$$;

comment on function public.get_metrics_snapshot(uuid, uuid) is
  'Ana ekran metrik ozeti (SECURITY INVOKER). KQ2 (20261015013000): tablo basina tek gecis count(*) FILTER; cikti sozlesmesi 20261006000410 ile ayni.';
