-- pgTAP: KQ2 20261015011000_lc_finance_rls_initplan
-- Calistirma (gölge, CANLIYA DEGIL): scripts/db-shadow-replay.sh <dizin> --keep ile kurulan konteynerde
--   docker exec -i <golge> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/tests/kq2_lc_finance_rls.test.sql
--   Cikti "not ok" satiri icermemeli. Tek islem, sonda ROLLBACK.
-- ILAN KONTROL: owner/gm ofis geneli; branch_manager yalniz kendi subesi (kendi ilani dahil degil); team_lead takimi + kendisi;
--   danisman yalniz kendisi; portals:view'siz rol 0; baska kiraci 0. Her rol icin politika sonucu lc_row_visible ile ayni kume.
-- EKSTRE: hesap kurali finance_account_access(...,'view') ile ayni (ofis hesabi expenses:view, kisisel hesap yalniz sahibi).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

set local session_replication_role = replica;
insert into public.tenants(id, name, slug, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'KQ2 A', 'kq2-a', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'KQ2 B', 'kq2-b', 'active');
insert into public.profiles(id, tenant_id, full_name, role, branch_id, team_id) values
  ('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sahip A', 'owner', null, null),
  ('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'Danisman 1', 'advisor', 'a1000000-0000-4000-8000-0000000000c1', 'a2000000-0000-4000-8000-0000000000d1'),
  ('a0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'Danisman 2', 'advisor', 'a1000000-0000-4000-8000-0000000000c2', null),
  ('a0000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000001', 'Muhasebe', 'accounting', null, null),
  ('a0000000-0000-4000-8000-0000000000a5', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sube Muduru', 'branch_manager', 'a1000000-0000-4000-8000-0000000000c1', null),
  ('a0000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-000000000001', 'Takim Lideri', 'team_lead', 'a1000000-0000-4000-8000-0000000000c1', 'a2000000-0000-4000-8000-0000000000d1'),
  ('a0000000-0000-4000-8000-0000000000a7', 'aaaaaaaa-0000-4000-8000-000000000001', 'Genel Mudur', 'gm', null, null),
  ('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'Sahip B', 'owner', null, null);
insert into public.listing_anomalies(id, tenant_id, property_id, type, dedupe_key, branch_id, team_id, advisor_id) values
  ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(), 'portal_missing', 'kq2-1', 'a1000000-0000-4000-8000-0000000000c1', 'a2000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-0000000000a2'),
  ('e0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(), 'portal_missing', 'kq2-2', 'a1000000-0000-4000-8000-0000000000c2', null, 'a0000000-0000-4000-8000-0000000000a3'),
  ('e0000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(), 'portal_missing', 'kq2-3', 'a1000000-0000-4000-8000-0000000000c1', null, 'a0000000-0000-4000-8000-0000000000a6'),
  ('e0000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(), 'portal_missing', 'kq2-4', null, null, 'a0000000-0000-4000-8000-0000000000a5'),
  ('e0000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(), 'portal_missing', 'kq2-5', 'a1000000-0000-4000-8000-0000000000c1', 'a2000000-0000-4000-8000-0000000000d1', null),
  ('e0000000-0000-4000-8000-000000000006', 'bbbbbbbb-0000-4000-8000-000000000001', gen_random_uuid(), 'portal_missing', 'kq2-6', null, null, 'b0000000-0000-4000-8000-0000000000b1');
insert into public.finance_accounts(id, tenant_id, kind, name, opening_date, owner_scope, owner_user_id) values
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'bank', 'Ofis', '2026-01-01', 'office', null),
  ('f0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'bank', 'D1 kisisel', '2026-01-01', 'user', 'a0000000-0000-4000-8000-0000000000a2'),
  ('f0000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'bank', 'D2 kisisel', '2026-01-01', 'user', 'a0000000-0000-4000-8000-0000000000a3'),
  ('f0000000-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001', 'bank', 'B ofis', '2026-01-01', 'office', null);
insert into public.finance_statement_imports(id, tenant_id, account_id, file_hash, format, row_count)
select ('f1000000-0000-4000-8000-00000000000' || n)::uuid,
       case when n = 4 then 'bbbbbbbb-0000-4000-8000-000000000001'::uuid else 'aaaaaaaa-0000-4000-8000-000000000001'::uuid end,
       ('f0000000-0000-4000-8000-00000000000' || n)::uuid, repeat(n::text, 64), 'csv', 1
from generate_series(1, 4) n;
insert into public.finance_statement_mappings(tenant_id, account_id, mapping)
select case when n = 4 then 'bbbbbbbb-0000-4000-8000-000000000001'::uuid else 'aaaaaaaa-0000-4000-8000-000000000001'::uuid end,
       ('f0000000-0000-4000-8000-00000000000' || n)::uuid, '{}'::jsonb
from generate_series(1, 4) n;
set local session_replication_role = origin;

create function pg_temp.claims(p_uid uuid, p_tenant uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('tenant_id', p_tenant, 'role', p_role))::text, true);
end $$;
-- RLS altinda gorunen kimlikler (p_sql 'id' kolonu dondurur).
create function pg_temp.visible(p_uid uuid, p_tenant uuid, p_role text, p_sql text) returns uuid[] language plpgsql as $$
declare r uuid[];
begin
  perform pg_temp.claims(p_uid, p_tenant, p_role);
  execute 'set local role authenticated';
  execute 'select coalesce(array_agg(id order by id), ''{}'') from (' || p_sql || ') q' into r;
  execute 'reset role';
  return r;
end $$;
-- Eski politika anlami (tekil yardimcilarla, RLS'siz tarama).
create function pg_temp.lc_expected(p_uid uuid, p_tenant uuid, p_role text) returns uuid[] language plpgsql as $$
declare r uuid[];
begin
  perform pg_temp.claims(p_uid, p_tenant, p_role);
  select coalesce(array_agg(a.id order by a.id), '{}') into r
  from public.listing_anomalies a
  where a.tenant_id = public.current_tenant_id()
    and public.has_effective_permission('portals', 'view')
    and public.lc_row_visible(a.branch_id, a.team_id, a.advisor_id);
  return r;
end $$;
create function pg_temp.fin_expected(p_uid uuid, p_tenant uuid, p_role text) returns uuid[] language plpgsql as $$
declare r uuid[];
begin
  perform pg_temp.claims(p_uid, p_tenant, p_role);
  select coalesce(array_agg(i.id order by i.id), '{}') into r
  from public.finance_statement_imports i
  where i.tenant_id = public.current_active_tenant_id()
    and public.finance_account_access(i.account_id, 'view');
  return r;
end $$;

-- ---------- Ilan kontrol: rol matrisi ----------
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', 'select id from public.listing_anomalies'),
  array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
        'e0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000005']::uuid[], 'sahip: ofis geneli (B satiri yok)');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a7', 'aaaaaaaa-0000-4000-8000-000000000001', 'gm', 'select id from public.listing_anomalies'),
  pg_temp.visible('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', 'select id from public.listing_anomalies'),
  'genel mudur: sahip ile ayni (ofis geneli)');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a5', 'aaaaaaaa-0000-4000-8000-000000000001', 'branch_manager', 'select id from public.listing_anomalies'),
  array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000005']::uuid[],
  'sube muduru: yalniz kendi subesi (subesiz kendi ilani dahil degil)');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-000000000001', 'team_lead', 'select id from public.listing_anomalies'),
  array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000005']::uuid[],
  'takim lideri: takimi + kendi ilani');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor', 'select id from public.listing_anomalies'),
  array['e0000000-0000-4000-8000-000000000001']::uuid[], 'danisman 1: yalniz kendi');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor', 'select id from public.listing_anomalies'),
  array['e0000000-0000-4000-8000-000000000002']::uuid[], 'danisman 2: yalniz kendi');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000001', 'accounting', 'select id from public.listing_anomalies'),
  '{}'::uuid[], 'muhasebe (portals:view yok): 0 satir');
select is(pg_temp.visible('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'owner', 'select id from public.listing_anomalies'),
  array['e0000000-0000-4000-8000-000000000006']::uuid[], 'baska kiraci sahibi: yalniz kendi kiracisi, A satirlari 0');

-- ---------- Ilan kontrol: lc_row_visible ile esdegerlik ----------
select is(pg_temp.visible(u.id, 'aaaaaaaa-0000-4000-8000-000000000001', u.role, 'select id from public.listing_anomalies'),
          pg_temp.lc_expected(u.id, 'aaaaaaaa-0000-4000-8000-000000000001', u.role),
          'lc esdegerlik: ' || u.role || ' ' || u.id)
from (values
  ('a0000000-0000-4000-8000-0000000000a1'::uuid, 'owner'),
  ('a0000000-0000-4000-8000-0000000000a5'::uuid, 'branch_manager'),
  ('a0000000-0000-4000-8000-0000000000a6'::uuid, 'team_lead'),
  ('a0000000-0000-4000-8000-0000000000a2'::uuid, 'advisor')
) u(id, role);

select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public'
    and policyname in ('listing_anomalies_select', 'listing_control_events_select', 'listing_verifications_select',
                       'portal_listing_health_select', 'property_control_state_select', 'lc_lifecycle_events_select')
    and (qual ~ 'lc_row_visible' or qual !~ 'lc_scope_sees_all')
), '6 ilan kontrol politikasi satir basina lc_row_visible cagirmiyor, kapsam yardimcilarini kullaniyor');

-- ---------- Ekstre tablolari ----------
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', 'select id from public.finance_statement_imports'),
  array['f1000000-0000-4000-8000-000000000001']::uuid[], 'sahip: ofis hesabi ekstresi (danismanin kisisel hesabi degil)');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor', 'select id from public.finance_statement_imports'),
  array['f1000000-0000-4000-8000-000000000002']::uuid[], 'danisman 1: yalniz kendi kisisel hesabi');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000001', 'accounting', 'select id from public.finance_statement_imports'),
  array['f1000000-0000-4000-8000-000000000001']::uuid[], 'muhasebe (expenses:view): ofis hesabi');
select is(pg_temp.visible('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'owner', 'select id from public.finance_statement_imports'),
  array['f1000000-0000-4000-8000-000000000004']::uuid[], 'baska kiraci: yalniz kendi, A satirlari 0');
select is(pg_temp.visible(u.id, 'aaaaaaaa-0000-4000-8000-000000000001', u.role, 'select id from public.finance_statement_imports'),
          pg_temp.fin_expected(u.id, 'aaaaaaaa-0000-4000-8000-000000000001', u.role),
          'ekstre esdegerlik (finance_account_access): ' || u.role || ' ' || u.id)
from (values
  ('a0000000-0000-4000-8000-0000000000a1'::uuid, 'owner'),
  ('a0000000-0000-4000-8000-0000000000a2'::uuid, 'advisor'),
  ('a0000000-0000-4000-8000-0000000000a3'::uuid, 'advisor'),
  ('a0000000-0000-4000-8000-0000000000a4'::uuid, 'accounting')
) u(id, role);
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor', 'select account_id as id from public.finance_statement_mappings'),
  array['f0000000-0000-4000-8000-000000000003']::uuid[], 'eslestirme: danisman 2 yalniz kendi hesabi');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', 'select account_id as id from public.finance_statement_mappings'),
  array['f0000000-0000-4000-8000-000000000001']::uuid[], 'eslestirme: sahip ofis hesabi');
select ok(not exists (
  select 1 from pg_policies
  where schemaname = 'public' and policyname in ('finance_statement_imports_select', 'finance_statement_mappings_select')
    and qual ~ 'finance_account_access'
), 'ekstre politikalari satir basina finance_account_access cagirmiyor');

select * from finish();
rollback;
