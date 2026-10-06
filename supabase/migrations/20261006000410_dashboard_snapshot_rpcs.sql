-- MIGRATION 20261006000410_dashboard_snapshot_rpcs.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261006000410_dashboard_snapshot_rpcs.sql` ile uygular (000400'den SONRA, ayni pencere).
-- Geri alma: supabase/rollbacks/20261006000410_dashboard_snapshot_rpcs.rollback.sql
-- BAGIMLILIK: public.insights (20260826002500), public.tasks, public.customers, public.properties, public.customer_demands,
--   public.calls, public.deals, public.approval_requests, public.rent_charges, public.listing_closures, public.profiles,
--   public.current_tenant_id(). is_sample sutunlari (20260726000086 + 20260816001600), properties.authorization_end.
--
-- AMAC (PB42 ana ekran hizi): "Bugun" ana ekrani her acilista ~30 kucuk PostgREST turu atiyordu (sayaclar, bugunun gorevleri,
--   karar bekleyenler, donem istatistikleri, icgoru listesi). Uc RPC bunlari UC tura indirir; imzalar
--   src/app/app/_home/data-batch.ts ile birebir. Kod RPC yoksa/hata verirse mevcut sorgulara duser (sahte sifir uretilmez).
--
-- GUVENLIK: hepsi SECURITY INVOKER (RLS cagiranin yetkisiyle). p_tenant_id JWT tenant'iyla (current_tenant_id) ve
--   p_user_id auth.uid() ile eslesmiyorsa NULL doner (bos). Baska kullanicinin "benim" kapsami okunamaz; ofis kapsami zaten
--   RLS'in acik birakmadigi hicbir satiri gostermez. Para/komisyon alanlari (kacan komisyon toplami) kodda `earnings_all`
--   kapisiyla gosterilir; RPC yalniz RLS'in verdigi satirlari toplar.
--
-- ORNEK VERI KURALI: src/lib/sample-scope.ts ile ayni: gercek (is_sample=false, silinmemis) musteri VE portfoy sayisi
--   5'in altindaysa demo kayitlar sayilara dahil, degilse dislanir. Karar `sample_included` olarak doner; kod kendi
--   kararina esit degilse (olmamali) RPC sonucunu kullanmaz.
--
-- ZAMAN: gun/ay sinirlari Turkiye saatine gore (Europe/Istanbul, DST yok) -- src/lib/clock.ts trParts ile ayni.
-- ETKI: yalniz 3 yeni fonksiyon (ek). Tablo/politika/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.insights') is null then
    raise exception 'public.insights yok; once 20260826002500 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.tasks') is null or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.properties') is null or pg_catalog.to_regclass('public.customer_demands') is null
     or pg_catalog.to_regclass('public.calls') is null or pg_catalog.to_regclass('public.deals') is null
     or pg_catalog.to_regclass('public.approval_requests') is null or pg_catalog.to_regclass('public.rent_charges') is null
     or pg_catalog.to_regclass('public.listing_closures') is null then
    raise exception 'ana ekran tablolarindan biri yok (tasks/customers/properties/customer_demands/calls/deals/approval_requests/rent_charges/listing_closures).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'is_sample')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deals' and column_name = 'is_sample')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'properties' and column_name = 'authorization_end') then
    raise exception 'is_sample (tasks/deals; 20260726000086/096) veya properties.authorization_end sutunu yok; once ilgili migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Icgoru anlik goruntusu: cagiranin okunabilir icgoru satirlari (en cok 200) + durum sayaclari.
--    Kolonlar src/lib/insights/readable.ts INSIGHT_SELECT ile birebir; okunabilirlik (erteleme bitti mi) kodda secilir.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.get_insights_snapshot(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_tenant_id is distinct from public.current_tenant_id() then
    return null;
  end if;

  return jsonb_build_object(
    'version', 1,
    'computed_at', now(),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x))
      from (
        select i.id, i.kind, i.rule_id, i.severity, i.priority, i.title, i.why, i.evidence, i.href, i.entity_type, i.entity_id,
               i.is_forecast, i.confidence, i.state, i.snoozed_until, i.valid_until, i.created_at, i.narrative, i.narrative_source
        from public.insights i
        where i.tenant_id = p_tenant_id
          and i.recipient_user_id = v_uid
          and i.state in ('new', 'seen', 'snoozed')
          and i.valid_until > now()
        order by i.priority desc, i.created_at desc
        limit 200
      ) x
    ), '[]'::jsonb),
    'counts', (
      select jsonb_build_object(
        'new', count(*) filter (where i.state = 'new'),
        'seen', count(*) filter (where i.state = 'seen'),
        'snoozed', count(*) filter (where i.state = 'snoozed'),
        'dismissed', count(*) filter (where i.state = 'dismissed'),
        'accepted', count(*) filter (where i.state = 'accepted')
      )
      from public.insights i
      where i.tenant_id = p_tenant_id and i.recipient_user_id = v_uid and i.valid_until > now()
    )
  );
end;
$$;

comment on function public.get_insights_snapshot(uuid) is
  'Ana ekran brifingi: cagiranin icgoru satirlari + durum sayaclari tek JSON (SECURITY INVOKER; tenant JWT ile eslesmeli).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) Gorev anlik goruntusu: bugun vadeli / gecikmis sayaclari + bugunun ilk 5 acik gorevi; "ben" ve "ofis" kapsami birlikte.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.get_tasks_snapshot(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tr_now timestamp;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_real_customers bigint;
  v_real_properties bigint;
  v_include boolean;
  v_mine jsonb;
  v_office jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_user_id is null
     or p_tenant_id is distinct from public.current_tenant_id() or p_user_id is distinct from v_uid then
    return null;
  end if;

  v_tr_now := now() at time zone 'Europe/Istanbul';
  v_day_start := date_trunc('day', v_tr_now) at time zone 'Europe/Istanbul';
  v_day_end := v_day_start + interval '1 day';

  select count(*) into v_real_customers from public.customers c where c.tenant_id = p_tenant_id and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p where p.tenant_id = p_tenant_id and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < 5 and v_real_properties < 5);

  select jsonb_build_object(
    'due_today', count(*) filter (where t.due_at >= v_day_start and t.due_at < v_day_end),
    'overdue', count(*) filter (where t.due_at < v_day_start),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'due_at', o.due_at, 'priority', o.priority) order by o.due_at asc)
      from (
        select o.id, o.title, o.due_at, o.priority
        from public.tasks o
        where o.tenant_id = p_tenant_id and o.status = 'open' and o.due_at < v_day_end
          and o.assigned_to = v_uid and (v_include or o.is_sample = false)
        order by o.due_at asc
        limit 5
      ) o
    ), '[]'::jsonb)
  )
  into v_mine
  from public.tasks t
  where t.tenant_id = p_tenant_id and t.status = 'open' and t.assigned_to = v_uid and (v_include or t.is_sample = false);

  select jsonb_build_object(
    'due_today', count(*) filter (where t.due_at >= v_day_start and t.due_at < v_day_end),
    'overdue', count(*) filter (where t.due_at < v_day_start),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'due_at', o.due_at, 'priority', o.priority) order by o.due_at asc)
      from (
        select o.id, o.title, o.due_at, o.priority
        from public.tasks o
        where o.tenant_id = p_tenant_id and o.status = 'open' and o.due_at < v_day_end
          and (v_include or o.is_sample = false)
        order by o.due_at asc
        limit 5
      ) o
    ), '[]'::jsonb)
  )
  into v_office
  from public.tasks t
  where t.tenant_id = p_tenant_id and t.status = 'open' and (v_include or t.is_sample = false);

  return jsonb_build_object(
    'version', 1,
    'computed_at', now(),
    'sample_included', v_include,
    'mine', v_mine,
    'office', v_office
  );
end;
$$;

comment on function public.get_tasks_snapshot(uuid, uuid) is
  'Ana ekran gorevleri: bugun/gecikmis sayaclari + ilk 5 acik gorev, ben ve ofis kapsami (SECURITY INVOKER; p_user_id = auth.uid()).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Metrik anlik goruntusu: KPI sayaclari, talep durumlari, 7/30/90 gun donem istatistikleri, karar bekleyenler,
--    yetki belgesi bitenler. Sparkline tarihleri sinirli (100 / 500); sinira carpan seri kodda cizilmez (uydurma yok).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.get_metrics_snapshot(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_tr_now timestamp;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_yesterday_start timestamptz;
  v_month_start timestamptz;
  v_prev_month_start timestamptz;
  v_today date;
  v_real_customers bigint;
  v_real_properties bigint;
  v_include boolean;
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
  v_day_end := v_day_start + interval '1 day';
  v_yesterday_start := v_day_start - interval '1 day';
  v_month_start := date_trunc('month', v_tr_now) at time zone 'Europe/Istanbul';
  v_prev_month_start := (date_trunc('month', v_tr_now) - interval '1 month') at time zone 'Europe/Istanbul';
  v_today := v_tr_now::date;

  select count(*) into v_real_customers from public.customers c where c.tenant_id = p_tenant_id and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p where p.tenant_id = p_tenant_id and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < 5 and v_real_properties < 5);

  -- KPI sayaclari (loadKpiCounts ile ayni tanimlar)
  select jsonb_build_object(
    'customer_count', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and (v_include or c.is_sample = false)),
    'property_count', (select count(*) from public.properties p where p.tenant_id = p_tenant_id and p.deleted_at is null and (v_include or p.is_sample = false)),
    'calls_today', (select count(*) from public.calls k where k.tenant_id = p_tenant_id and k.started_at >= v_day_start and (v_include or k.is_sample = false)),
    'calls_yesterday', (select count(*) from public.calls k where k.tenant_id = p_tenant_id and k.started_at >= v_yesterday_start and k.started_at < v_day_start and (v_include or k.is_sample = false)),
    'customers_this_month', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_month_start and (v_include or c.is_sample = false)),
    'customers_prev_month', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_prev_month_start and c.created_at < v_month_start and (v_include or c.is_sample = false)),
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
  select jsonb_build_object(
    'new', count(*) filter (where d.status = 'new'),
    'active', count(*) filter (where d.status = 'active'),
    'matched', count(*) filter (where d.status = 'matched')
  ) into v_demands
  from public.customer_demands d
  where d.tenant_id = p_tenant_id and (v_include or d.is_sample = false);

  -- Donem istatistikleri 7/30/90 (loadPeriodStats): sayaclar + 90 gunluk tarih serisi (500 siniri)
  select jsonb_build_object(
    'p7', jsonb_build_object(
      'customers', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_now - interval '7 days' and (v_include or c.is_sample = false)),
      'customers_prev', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_now - interval '14 days' and c.created_at < v_now - interval '7 days' and (v_include or c.is_sample = false)),
      'demands', (select count(*) from public.customer_demands d where d.tenant_id = p_tenant_id and d.created_at >= v_now - interval '7 days' and (v_include or d.is_sample = false)),
      'demands_prev', (select count(*) from public.customer_demands d where d.tenant_id = p_tenant_id and d.created_at >= v_now - interval '14 days' and d.created_at < v_now - interval '7 days' and (v_include or d.is_sample = false))
    ),
    'p30', jsonb_build_object(
      'customers', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_now - interval '30 days' and (v_include or c.is_sample = false)),
      'customers_prev', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_now - interval '60 days' and c.created_at < v_now - interval '30 days' and (v_include or c.is_sample = false)),
      'demands', (select count(*) from public.customer_demands d where d.tenant_id = p_tenant_id and d.created_at >= v_now - interval '30 days' and (v_include or d.is_sample = false)),
      'demands_prev', (select count(*) from public.customer_demands d where d.tenant_id = p_tenant_id and d.created_at >= v_now - interval '60 days' and d.created_at < v_now - interval '30 days' and (v_include or d.is_sample = false))
    ),
    'p90', jsonb_build_object(
      'customers', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_now - interval '90 days' and (v_include or c.is_sample = false)),
      'customers_prev', (select count(*) from public.customers c where c.tenant_id = p_tenant_id and c.deleted_at is null and c.created_at >= v_now - interval '180 days' and c.created_at < v_now - interval '90 days' and (v_include or c.is_sample = false)),
      'demands', (select count(*) from public.customer_demands d where d.tenant_id = p_tenant_id and d.created_at >= v_now - interval '90 days' and (v_include or d.is_sample = false)),
      'demands_prev', (select count(*) from public.customer_demands d where d.tenant_id = p_tenant_id and d.created_at >= v_now - interval '180 days' and d.created_at < v_now - interval '90 days' and (v_include or d.is_sample = false))
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
  'Ana ekran metrikleri: KPI/talep/donem sayaclari + karar bekleyenler + yetki belgesi bitenler tek JSON (SECURITY INVOKER; p_user_id = auth.uid()).';

revoke all on function public.get_insights_snapshot(uuid) from public, anon;
revoke all on function public.get_tasks_snapshot(uuid, uuid) from public, anon;
revoke all on function public.get_metrics_snapshot(uuid, uuid) from public, anon;
grant execute on function public.get_insights_snapshot(uuid) to authenticated, service_role;
grant execute on function public.get_tasks_snapshot(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_metrics_snapshot(uuid, uuid) to authenticated, service_role;
