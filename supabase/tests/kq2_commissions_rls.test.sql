-- pgTAP: KQ2 20261015010000_commissions_rls_initplan + 20261015014000_index_hygiene (yeni indeks)
-- Calistirma (gölge, CANLIYA DEGIL): scripts/db-shadow-replay.sh <dizin> --keep ile kurulan konteynerde
--   docker exec -i <golge> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/tests/kq2_commissions_rls.test.sql
--   Cikti "not ok" satiri icermemeli. Her sey tek islemde, sonda ROLLBACK (gölgede iz birakmaz).
-- ROL MATRISI: danisman yalniz kendi anlasmasi + payi olan komisyonlari; earnings_all izinli rol (owner, accounting) ofisin
--   tumunu; earnings_all'siz takim lideri hicbirini (kendi anlasmasi/payi yoksa); baska kiracidan 0 satir. Politika sonucu her
--   kullanici icin tekil kontrol can_view_commission_earnings ile birebir ayni kume olmali. Plan: korelasyonlu SubPlan YOK.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

-- ---------- Fixture (tetikleyici/FK atlanir: yalniz RLS davranisi sinanir) ----------
set local session_replication_role = replica;
insert into public.tenants(id, name, slug, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'KQ2 A', 'kq2-a', 'active'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'KQ2 B', 'kq2-b', 'active');
insert into public.profiles(id, tenant_id, full_name, role) values
  ('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sahip A', 'owner'),
  ('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'Danisman 1', 'advisor'),
  ('a0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'Danisman 2', 'advisor'),
  ('a0000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000001', 'Muhasebe', 'accounting'),
  ('a0000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-000000000001', 'Takim Lideri', 'team_lead'),
  ('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'Sahip B', 'owner'),
  ('b0000000-0000-4000-8000-0000000000b2', 'bbbbbbbb-0000-4000-8000-000000000001', 'Danisman B', 'advisor');
insert into public.deals(id, tenant_id, deal_type, assigned_to) values
  ('d0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'sale', 'a0000000-0000-4000-8000-0000000000a2'),
  ('d0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'sale', 'a0000000-0000-4000-8000-0000000000a3'),
  ('d0000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'sale', 'a0000000-0000-4000-8000-0000000000a1'),
  ('d0000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'sale', 'a0000000-0000-4000-8000-0000000000a1'),
  ('d0000000-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001', 'sale', 'b0000000-0000-4000-8000-0000000000b2');
insert into public.commissions(id, tenant_id, deal_id, gross_amount) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 1000),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 2000),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 3000),
  ('c0000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 4000),
  ('c0000000-0000-4000-8000-000000000005', 'bbbbbbbb-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 5000);
-- Danisman 1, sahibin anlasmasindaki c3'te pay sahibi; B'deki danisman A'da pay sahibi OLAMAZ (FK), B'de kendi anlasmasi var.
insert into public.commission_splits(tenant_id, commission_id, label, share_rate, profile_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'Pay', 0.5, 'a0000000-0000-4000-8000-0000000000a2');
set local session_replication_role = origin;

-- ---------- Yardimcilar ----------
create function pg_temp.claims(p_uid uuid, p_tenant uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated',
    'app_metadata', json_build_object('tenant_id', p_tenant, 'role', p_role))::text, true);
end $$;
-- Politika (authenticated + RLS) altinda gorunen komisyon kimlikleri.
create function pg_temp.visible(p_uid uuid, p_tenant uuid, p_role text) returns uuid[] language plpgsql as $$
declare r uuid[];
begin
  perform pg_temp.claims(p_uid, p_tenant, p_role);
  execute 'set local role authenticated';
  select coalesce(array_agg(id order by id), '{}') into r from public.commissions;
  execute 'reset role';
  return r;
end $$;
-- Tekil kontrol fonksiyonunun (DEFINER) ayni kullanici icin dogru dedigi kimlikler (RLS'siz tarama).
create function pg_temp.expected(p_uid uuid, p_tenant uuid, p_role text) returns uuid[] language plpgsql as $$
declare r uuid[];
begin
  perform pg_temp.claims(p_uid, p_tenant, p_role);
  select coalesce(array_agg(c.id order by c.id), '{}') into r
  from public.commissions c
  where public.can_view_commission_earnings(c.tenant_id, c.deal_id, c.id);
  return r;
end $$;
create function pg_temp.plan_text(p_uid uuid, p_tenant uuid, p_role text) returns text language plpgsql as $$
declare r text := ''; l text;
begin
  perform pg_temp.claims(p_uid, p_tenant, p_role);
  execute 'set local role authenticated';
  for l in execute 'explain (costs off) select c.id, c.gross_amount from public.commissions c where c.is_sample = false order by c.created_at desc' loop
    r := r || l || E'\n';
  end loop;
  execute 'reset role';
  return r;
end $$;

-- ---------- Rol matrisi ----------
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor'),
  array['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003']::uuid[],
  'danisman 1: kendi anlasmasi (c1) + pay sahibi oldugu (c3)');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor'),
  array['c0000000-0000-4000-8000-000000000002']::uuid[],
  'danisman 2: yalniz kendi anlasmasi (c2)');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  array['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
        'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004']::uuid[],
  'sahip (earnings_all): ofisin tum komisyonlari, baska kiracininki yok');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000001', 'accounting'),
  array['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
        'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004']::uuid[],
  'muhasebe (earnings_all izni): ofisin tum komisyonlari');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-000000000001', 'team_lead'),
  '{}'::uuid[],
  'takim lideri (earnings_all yok, kendi anlasmasi/payi yok): 0 satir');
select is(pg_temp.visible('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'owner'),
  array['c0000000-0000-4000-8000-000000000005']::uuid[],
  'baska kiraci sahibi: yalniz kendi kiracisi (A satirlari 0)');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a2', 'bbbbbbbb-0000-4000-8000-000000000001', 'advisor'),
  '{}'::uuid[],
  'JWT baska kiraciyi gosterirse (profil eslesmez): 0 satir');
select is(pg_temp.visible('b0000000-0000-4000-8000-0000000000b2', 'bbbbbbbb-0000-4000-8000-000000000001', 'advisor'),
  array['c0000000-0000-4000-8000-000000000005']::uuid[],
  'B danismani: yalniz kendi anlasmasi, A satirlari 0');

-- ---------- Tekil kontrol ile esdegerlik ----------
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor'),
          pg_temp.expected('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor'),
  'danisman 1: politika = can_view_commission_earnings');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
          pg_temp.expected('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  'sahip: politika = can_view_commission_earnings');
select is(pg_temp.visible('a0000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-000000000001', 'team_lead'),
          pg_temp.expected('a0000000-0000-4000-8000-0000000000a6', 'aaaaaaaa-0000-4000-8000-000000000001', 'team_lead'),
  'takim lideri: politika = can_view_commission_earnings');

-- earnings_all istisnasi: danismana kullanici bazli earnings_all verilince hepsini gorur (izin matrisi politikaya yansir).
set local session_replication_role = replica;
insert into public.user_permission_overrides(tenant_id, user_id, module, actions)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a3', 'earnings_all', array['view']);
set local session_replication_role = origin;
select is(cardinality(pg_temp.visible('a0000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor')), 4,
  'danisman 2 + earnings_all istisnasi: ofisin 4 komisyonu');

-- ---------- Politika metni ve plan ----------
select ok((select qual from pg_policies where schemaname = 'public' and tablename = 'commissions' and policyname = 'commissions_select')
          !~ 'can_view_commission_earnings',
  'commissions_select artik satir basina can_view_commission_earnings cagirmiyor');
select ok(pg_temp.plan_text('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor') ~ 'InitPlan',
  'plan: satirdan bagimsiz kontroller InitPlan');
select ok(pg_temp.plan_text('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'advisor')
          !~ '(Filter|One-Time Filter): [^\n]*\(SubPlan [0-9]+\)',
  'plan: korelasyonlu SubPlan yok (yalniz hashed SubPlan / InitPlan)');

-- ---------- Indeks ----------
select ok(pg_catalog.to_regclass('public.idx_commission_splits_commission_profile') is not null,
  'idx_commission_splits_commission_profile var');
select ok(pg_get_indexdef('public.idx_commission_splits_commission_profile'::regclass)
          ~ '\(commission_id, profile_id\) WHERE \(profile_id IS NOT NULL\)',
  'yeni indeks (commission_id, profile_id) WHERE profile_id IS NOT NULL');

select * from finish();
rollback;
