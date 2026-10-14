-- 20261015013000 geri alma: get_metrics_snapshot'in 20261006000410 govdesi (gölge zincirinden pg_get_functiondef, birebir;
--   canli ile md5 esit). CREATE OR REPLACE ACL'i korur. Cikti sozlesmesi zaten ayni oldugu icin kod etkilenmez.
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_metrics_snapshot(p_tenant_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

comment on function public.get_metrics_snapshot(uuid, uuid) is
  'Ana ekran metrikleri: KPI/talep/donem sayaclari + karar bekleyenler + yetki belgesi bitenler tek JSON (SECURITY INVOKER; p_user_id = auth.uid()).';
