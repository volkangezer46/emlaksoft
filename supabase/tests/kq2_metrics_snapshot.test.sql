-- pgTAP: KQ2 20261015013000_metrics_snapshot_single_pass
-- Calistirma (gölge, CANLIYA DEGIL): scripts/db-shadow-replay.sh <dizin> --keep ile kurulan konteynerde
--   docker exec -i <golge> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/tests/kq2_metrics_snapshot.test.sql
--   Cikti "not ok" satiri icermemeli. Tek islem, sonda ROLLBACK.
-- KABUL: yeni get_metrics_snapshot ciktisi ESKI govdeyle (20261006000410, asagida gecici semada birebir) anahtar anahtar esit:
--   (1) ornek veri DAHIL senaryosu (gercek musteri ve portfoy < 5), (2) ornek veri HARIC senaryosu (>= 5 gercek), (3) baska
--   kiraci / baska kullanici parametresi NULL; ayrica authenticated rolle (RLS altinda) iki govde ayni sonucu verir.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

create schema kq2_cmp;
grant usage on schema kq2_cmp to authenticated;

-- ESKI govde (20261006000410 / 20261011 oncesi canli ile md5 esit), yalniz karsilastirma icin gecici semada.
CREATE OR REPLACE FUNCTION kq2_cmp.get_metrics_snapshot_old(p_tenant_id uuid, p_user_id uuid)
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

grant execute on function kq2_cmp.get_metrics_snapshot_old(uuid, uuid) to authenticated;

set local session_replication_role = replica;
insert into public.tenants(id, name, slug, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'KQ2 A', 'kq2-a', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'KQ2 B', 'kq2-b', 'active');
insert into public.profiles(id, tenant_id, full_name, role, created_at) values
  ('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sahip A', 'owner', now() - interval '400 days'),
  ('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'Danisman 1', 'advisor', now() - interval '400 days'),
  ('a0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'Danisman 2', 'advisor', now() - interval '400 days'),
  ('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'Sahip B', 'owner', now() - interval '400 days');
-- Senaryo 1: 3 gercek + 40 ornek musteri (ornek DAHIL). Tarihler 0..199 gun geriye yayilir, bazilari silinmis.
insert into public.customers(tenant_id, full_name, is_sample, created_at, deleted_at)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'Ornek ' || n, true, now() - (n * interval '5 days') - (n * interval '17 minutes'),
       case when n % 9 = 0 then now() else null end
from generate_series(0, 39) n;
insert into public.customers(tenant_id, full_name, is_sample, created_at)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'Gercek ' || n, false, now() - (n * interval '13 days')
from generate_series(0, 2) n;
insert into public.customers(tenant_id, full_name, is_sample, created_at)
select 'bbbbbbbb-0000-4000-8000-000000000001', 'B ' || n, false, now() - (n * interval '3 days') from generate_series(0, 20) n;
insert into public.properties(tenant_id, property_code, transaction_type, property_type, is_sample, status, title,
                              authorization_end, assigned_to, deleted_at)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'KQ2-' || n, 'sale', 'apartment', n % 3 <> 0, 'live', 'Ilan ' || n,
       (now() at time zone 'Europe/Istanbul')::date + (n % 20),
       case when n % 2 = 0 then 'a0000000-0000-4000-8000-0000000000a1'::uuid else 'a0000000-0000-4000-8000-0000000000a2'::uuid end,
       case when n = 7 then now() else null end
from generate_series(0, 11) n;
insert into public.calls(tenant_id, direction, phone, is_sample, started_at)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'outbound', '05320000000', n % 2 = 0, now() - (n * interval '7 hours')
from generate_series(0, 60) n;
insert into public.customer_demands(tenant_id, customer_id, transaction_type, status, is_sample, created_at)
select 'aaaaaaaa-0000-4000-8000-000000000001', c.id, 'sale',
       (array['new', 'active', 'matched', 'closed'])[1 + (row_number() over (order by c.created_at))::int % 4],
       c.is_sample, c.created_at + interval '1 hour'
from public.customers c where c.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into public.deals(tenant_id, deal_type, assigned_to, is_sample, updated_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'sale', 'a0000000-0000-4000-8000-0000000000a2', true, now() - interval '3 days');
set local session_replication_role = origin;

create function pg_temp.claims(p_uid uuid, p_tenant uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('tenant_id', p_tenant, 'role', p_role))::text, true);
end $$;
create function pg_temp.pair(p_uid uuid, p_tenant uuid, p_role text, p_as_auth boolean) returns jsonb[] language plpgsql as $$
declare a jsonb; b jsonb;
begin
  perform pg_temp.claims(p_uid, p_tenant, p_role);
  if p_as_auth then execute 'set local role authenticated'; end if;
  a := kq2_cmp.get_metrics_snapshot_old(p_tenant, p_uid);
  b := public.get_metrics_snapshot(p_tenant, p_uid);
  if p_as_auth then execute 'reset role'; end if;
  return array[a, b];
end $$;

-- Senaryo 1: ornek DAHIL
select is((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2],
          (pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[1],
          'ornek DAHIL: yeni = eski (tum anahtarlar)');
select is(((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2] ->> 'sample_included'), 'true',
          'senaryo 1 gercekten ornek DAHIL');
select ok((((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2]) #>> '{kpi,customer_count}')::int > 3
          and (((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2]) #>> '{period,p90,demands}')::int > 0
          and (((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2]) #>> '{kpi,calls_today}')::int
            + (((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2]) #>> '{kpi,calls_yesterday}')::int > 0,
          'senaryo 1 sayaclari bos degil (karsilastirma anlamli)');
select is((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', true))[2],
          (pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', true))[1],
          'ornek DAHIL, authenticated (RLS altinda) sahip: yeni = eski');
select is((pg_temp.pair('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor', true))[2],
          (pg_temp.pair('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor', true))[1],
          'ornek DAHIL, authenticated danisman: yeni = eski');

-- Senaryo 2: 6 gercek musteri + 6 gercek portfoy -> ornek HARIC
set local session_replication_role = replica;
insert into public.customers(tenant_id, full_name, is_sample, created_at)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'Gercek ek ' || n, false, now() - (n * interval '29 days') - interval '2 hours'
from generate_series(0, 5) n;
insert into public.properties(tenant_id, property_code, transaction_type, property_type, is_sample, status, title)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'KQ2-R' || n, 'sale', 'apartment', false, 'draft', 'Gercek ' || n
from generate_series(0, 5) n;
set local session_replication_role = origin;

select is((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2],
          (pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[1],
          'ornek HARIC: yeni = eski (tum anahtarlar)');
select is(((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2] ->> 'sample_included'), 'false',
          'senaryo 2 gercekten ornek HARIC');
select ok((((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', false))[2]) #>> '{kpi,customer_count}')::int = 9,
          'senaryo 2: yalniz 9 gercek musteri sayilir');
select is((pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', true))[2],
          (pg_temp.pair('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', true))[1],
          'ornek HARIC, authenticated sahip: yeni = eski');

-- Kapi: baska kiraci / baska kullanici -> NULL (eskisi gibi)
select pg_temp.claims('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner');
select is(public.get_metrics_snapshot('bbbbbbbb-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a1'), null::jsonb,
          'baska kiraci parametresi: NULL');
select is(public.get_metrics_snapshot('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a2'), null::jsonb,
          'baska kullanici parametresi: NULL');

select * from finish();
rollback;
