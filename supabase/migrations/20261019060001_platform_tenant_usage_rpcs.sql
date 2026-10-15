-- MIGRATION 20261019060001_platform_tenant_usage_rpcs.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir:
--   - platform_tenant_limit_usage yokken Ofisler listesindeki "Limitine yakin" suzgeci bos sonuc + "kurulum bekliyor"
--     notu gosterir, satir rozeti cizilmez, genisleme icgorusu uretilmez.
--   - platform_tenant_value_counts yokken deneme degeri ozeti ve geri kazanim e-postasi GONDERILMEZ (sayi uydurulmaz).
--   - platform_insights.kind 'revenue_opportunity' yokken genisleme icgorusu ayri yazilir ve CHECK hatasinda atlanir
--     (diger icgoruler etkilenmez).
-- Geri alma: supabase/rollbacks/20261019060001_platform_tenant_usage_rpcs.rollback.sql
-- BAGIMLILIK: 20261013004000 (tenant_entitlement_resolve, effective_seat_limit), 20260826002600 (platform_insights),
--   plan_entitlements. demand_property_matches (20261018020000) ISTEGE BAGLI: yoksa eslesme sayisi 0 doner.
--
-- NE:
--   platform_tenant_limit_usage(p_tenant_ids, p_min_ratio): PA-5 genisleme sinyali. Ofis x olcu (koltuk, musteri,
--     aktif portfoy, sube) icin kullanim ve ETKIN limit (plan_entitlements + ofise ozel istisna + ek koltuk; kapasite
--     tetikleyicisiyle AYNI sayim). Yalniz limiti olan olculer; kullanim/limit >= p_min_ratio olanlar doner.
--   platform_tenant_value_counts(p_tenant_ids): PA-12 deger ozeti (portfoy, musteri, eslesme, aktif kullanici).
--   Ikisi de SECURITY INVOKER + yalniz service_role EXECUTE (platform kapisindan sonra sunucu cagirir; ofis
--   kullanicisi cagiramaz). Ofisin musteri verisi okunmaz, yalniz SAYI doner.
--   platform_insights.kind CHECK'i 'revenue_opportunity' ile genisler (mevcut degerler korunur).
set local lock_timeout = '5s';

create or replace function public.platform_tenant_limit_usage(p_tenant_ids uuid[] default null, p_min_ratio numeric default 0)
returns table (tenant_id uuid, metric text, used integer, cap integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select x.id, pe.seat_limit, pe.customer_limit, pe.active_property_limit, pe.branch_limit
    from public.tenants x
    join public.plan_entitlements pe on pe.plan = x.plan
    where x.status <> 'cancelled'
      and (p_tenant_ids is null or x.id = any (p_tenant_ids))
  ),
  caps as (
    select t.id,
      case when t.seat_limit is null then null
           else greatest(public.tenant_entitlement_resolve(t.id, 'seats', t.seat_limit),
                         coalesce(public.effective_seat_limit(t.id), 0)) end as seats_cap,
      public.tenant_entitlement_resolve(t.id, 'customers', t.customer_limit) as customers_cap,
      public.tenant_entitlement_resolve(t.id, 'active_properties', t.active_property_limit) as properties_cap,
      public.tenant_entitlement_resolve(t.id, 'branches', t.branch_limit) as branches_cap
    from t
  ),
  su as (
    select p.tenant_id, count(*)::int as n from public.profiles p
    where p.is_active = true and p.tenant_id in (select c.id from caps c where c.seats_cap is not null)
    group by p.tenant_id
  ),
  cu as (
    select c.tenant_id, count(*)::int as n from public.customers c
    where c.deleted_at is null and c.tenant_id in (select k.id from caps k where k.customers_cap is not null)
    group by c.tenant_id
  ),
  pu as (
    select p.tenant_id, count(*)::int as n from public.properties p
    where p.deleted_at is null and p.status in ('draft', 'live', 'reserved')
      and p.tenant_id in (select k.id from caps k where k.properties_cap is not null)
    group by p.tenant_id
  ),
  bu as (
    select b.tenant_id, count(*)::int as n from public.branches b
    where b.is_active = true and b.tenant_id in (select k.id from caps k where k.branches_cap is not null)
    group by b.tenant_id
  ),
  m as (
    select caps.id, 'seats'::text as metric, coalesce(su.n, 0) as used, caps.seats_cap as cap
    from caps left join su on su.tenant_id = caps.id where caps.seats_cap is not null
    union all
    select caps.id, 'customers', coalesce(cu.n, 0), caps.customers_cap
    from caps left join cu on cu.tenant_id = caps.id where caps.customers_cap is not null
    union all
    select caps.id, 'active_properties', coalesce(pu.n, 0), caps.properties_cap
    from caps left join pu on pu.tenant_id = caps.id where caps.properties_cap is not null
    union all
    select caps.id, 'branches', coalesce(bu.n, 0), caps.branches_cap
    from caps left join bu on bu.tenant_id = caps.id where caps.branches_cap is not null
  )
  select m.id, m.metric, m.used, m.cap
  from m
  where m.cap > 0 and m.used::numeric / m.cap::numeric >= coalesce(p_min_ratio, 0)
  order by m.id, m.metric;
$$;

revoke all on function public.platform_tenant_limit_usage(uuid[], numeric) from public, anon, authenticated;
grant execute on function public.platform_tenant_limit_usage(uuid[], numeric) to service_role;

comment on function public.platform_tenant_limit_usage(uuid[], numeric) is
  'PA-5: ofis x olcu kullanim / etkin limit (kapasite tetikleyicisiyle ayni sayim); yalniz service_role.';

create or replace function public.platform_tenant_value_counts(p_tenant_ids uuid[])
returns table (tenant_id uuid, properties integer, customers integer, matches integer, members integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_tenant_ids is null or cardinality(p_tenant_ids) = 0 then
    return;
  end if;
  if cardinality(p_tenant_ids) > 500 then
    raise exception 'platform_tenant_value_counts: en cok 500 ofis' using errcode = '22023';
  end if;
  if pg_catalog.to_regclass('public.demand_property_matches') is not null then
    return query
      select t.id,
        (select count(*)::int from public.properties p where p.tenant_id = t.id and p.deleted_at is null),
        (select count(*)::int from public.customers c where c.tenant_id = t.id and c.deleted_at is null),
        (select count(*)::int from public.demand_property_matches d where d.tenant_id = t.id),
        (select count(*)::int from public.profiles f where f.tenant_id = t.id and f.is_active = true)
      from public.tenants t
      where t.id = any (p_tenant_ids);
  else
    return query
      select t.id,
        (select count(*)::int from public.properties p where p.tenant_id = t.id and p.deleted_at is null),
        (select count(*)::int from public.customers c where c.tenant_id = t.id and c.deleted_at is null),
        0,
        (select count(*)::int from public.profiles f where f.tenant_id = t.id and f.is_active = true)
      from public.tenants t
      where t.id = any (p_tenant_ids);
  end if;
end;
$$;

revoke all on function public.platform_tenant_value_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.platform_tenant_value_counts(uuid[]) to service_role;

comment on function public.platform_tenant_value_counts(uuid[]) is
  'PA-12: ofis basina portfoy / musteri / eslesme / aktif kullanici SAYISI (deger ozeti e-postasi); yalniz service_role.';

-- platform_insights.kind: genisleme firsati turu (mevcut degerler aynen korunur).
do $$
declare
  v_name text;
begin
  if pg_catalog.to_regclass('public.platform_insights') is null then
    return;
  end if;
  for v_name in
    select c.conname from pg_catalog.pg_constraint c
    where c.conrelid = 'public.platform_insights'::regclass and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%tenant_churn%'
  loop
    execute pg_catalog.format('alter table public.platform_insights drop constraint %I', v_name);
  end loop;
  alter table public.platform_insights add constraint platform_insights_kind_check check (kind in (
    'tenant_churn', 'revenue_anomaly', 'payment_risk', 'system_health', 'partner_signal', 'anomaly', 'forecast', 'digest',
    'revenue_opportunity'
  ));
end $$;
