-- pgTAP: KQ2 20261015014000_index_hygiene + 20261015015000_agent_photos_bucket_limits +
--        20261015016000_revoke_anon_definer_rpcs + 20261015017000_realtime_publication_trim
-- Calistirma (gölge, CANLIYA DEGIL): scripts/db-shadow-replay.sh <dizin> --keep ile kurulan konteynerde
--   docker exec -i <golge> psql -h /var/run/postgresql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < supabase/tests/kq2_db_surface.test.sql
--   Cikti "not ok" satiri icermemeli. Tek islem, sonda ROLLBACK.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

-- ---------- anon EXECUTE geri alinan RPC'ler ----------
select ok(not has_function_privilege('anon', 'public.aidat_kpi()', 'EXECUTE'), 'anon: aidat_kpi EXECUTE yok');
select ok(not has_function_privilege('anon', 'public.tcmb_rate_on(date)', 'EXECUTE'), 'anon: tcmb_rate_on EXECUTE yok');
select ok(not has_function_privilege('anon', 'public.increment_template_usage(uuid)', 'EXECUTE'), 'anon: increment_template_usage EXECUTE yok');
select ok(not has_function_privilege('anon', 'public.log_property_price_change()', 'EXECUTE'), 'anon: log_property_price_change (tetikleyici) EXECUTE yok');
select ok(has_function_privilege('authenticated', 'public.aidat_kpi()', 'EXECUTE')
          and has_function_privilege('service_role', 'public.aidat_kpi()', 'EXECUTE'), 'aidat_kpi: authenticated + service_role korunur');
select ok(has_function_privilege('authenticated', 'public.tcmb_rate_on(date)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.increment_template_usage(uuid)', 'EXECUTE'),
  'tcmb_rate_on / increment_template_usage: authenticated korunur');

set local role anon;
select throws_ok('select public.aidat_kpi()', '42501', null, 'anon aidat_kpi cagrisi: permission denied');
select throws_ok($$select public.tcmb_rate_on(current_date)$$, '42501', null, 'anon tcmb_rate_on cagrisi: permission denied');
select throws_ok($$select public.increment_template_usage('00000000-0000-4000-8000-000000000000')$$, '42501', null,
  'anon increment_template_usage cagrisi: permission denied');
reset role;

-- Herkese acik sayfalarin RPC'leri anon'a ACIK kalir (portal, imza, randevu/vitrin, kayit, API).
select ok(bool_and(has_function_privilege('anon', f::regprocedure, 'EXECUTE')),
  'anon gereken token/public RPCler ve RLS yardimcilari acik kaldi')
from unnest(array[
  'public.contract_signer_resolve_short(text)', 'public.portal_customer_request(text,text,jsonb)',
  'public.portal_rent_receipt_target(text,uuid)', 'public.decide_property_price_proposal_by_token(text,uuid,text,text)',
  'public.growth_invite_preview(text)', 'public.vitrin_chat_context(text,uuid)',
  'public.api_v1_list(text,text,integer,timestamp with time zone)', 'public.current_tenant_id()', 'public.is_platform_staff()',
  'public.current_user_scope()', 'public.current_user_team_id()', 'public.current_user_branch_id()',
  'public.has_permission_with_scope(text,text,text,uuid)'
]) f;

-- Tetikleyici fonksiyonu EXECUTE'u kapali olsa da tetikleyici atesi calisir (EXECUTE denetlenmez).
create temp table kq2_trg_probe(id int, price numeric);
create function pg_temp.kq2_probe_fn() returns trigger language plpgsql as $$ begin new.price := new.price + 1; return new; end $$;
revoke execute on function pg_temp.kq2_probe_fn() from public;
create trigger kq2_probe before insert on kq2_trg_probe for each row execute function pg_temp.kq2_probe_fn();
grant insert, select on kq2_trg_probe to authenticated;
set local role authenticated;
insert into kq2_trg_probe values (1, 10);
reset role;
select is((select price from kq2_trg_probe where id = 1), 11::numeric, 'EXECUTE yetkisi olmayan rolde tetikleyici yine calisir');

-- ---------- Indeks hijyeni ----------
select ok(pg_catalog.to_regclass('public.idx_customers_tenant') is null, 'idx_customers_tenant dusuruldu');
select ok(pg_catalog.to_regclass('public.idx_demands_tenant_status') is null, 'idx_demands_tenant_status dusuruldu');
select ok(pg_catalog.to_regclass('public.uq_customers_tenant_id_id') is not null, 'kapsayan uq_customers_tenant_id_id duruyor');
select ok(pg_catalog.to_regclass('public.idx_demands_tenant_status_created') is not null, 'kapsayan idx_demands_tenant_status_created duruyor');
select ok(pg_catalog.to_regclass('public.idx_commission_splits_commission_profile') is not null, 'yeni commission_splits indeksi var');

-- ---------- agent-photos kovasi ----------
select is((select file_size_limit from storage.buckets where id = 'agent-photos'), 3145728::bigint, 'agent-photos: 3 MB siniri');
select is((select allowed_mime_types from storage.buckets where id = 'agent-photos'),
          array['image/jpeg', 'image/png', 'image/webp']::text[], 'agent-photos: yalniz jpeg/png/webp');
select is((select public from storage.buckets where id = 'agent-photos'), true, 'agent-photos: public bayragi degismedi');

-- ---------- Realtime yayini ----------
select is(
  (select array_agg(tablename::text order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  array['appointments', 'cash_entries', 'commissions', 'customer_demands', 'customers', 'deals',
        'finance_open_items', 'finance_parties', 'fsbo_leads', 'listing_control_events', 'listing_pool_entries',
        'notifications', 'offers', 'portal_listings', 'properties', 'property_keys', 'rent_charges', 'rent_payments',
        'support_ticket_attachments', 'support_ticket_messages', 'tasks']::text[],
  'supabase_realtime yalniz kodda abone olunan 21 tablo');
select ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname <> 'public'),
  'supabase_realtime: public disi tablo yok');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'customers')
          and exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tasks'),
  'canli yenileme akisi: musteri ve gorev tablolari yayinda');

select * from finish();
rollback;
