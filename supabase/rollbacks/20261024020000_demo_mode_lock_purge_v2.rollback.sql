-- ROLLBACK 20261024020000_demo_mode_lock_purge_v2.sql
-- SIRA: once 20261024020100_sample_personas_capacity.rollback.sql (kapasite fonksiyonlari profiles.is_sample okur).
-- purge_tenant_sample_data 20261006000600 govdesine doner; kilit fonksiyonlari/tetikleyicileri ve yeni sutunlar duser.
-- UYARI: demo ekip profilleri (profiles.is_sample = true) kalir; v1 purge onlara dokunmaz (Ofis 360'tan elle kaldirin).
-- Ledger'a dokunmaz.

set local lock_timeout = '5s';

drop trigger if exists trg_customers_sample_seed_lock on public.customers;
drop trigger if exists trg_properties_sample_seed_lock on public.properties;
drop function if exists public.sample_seed_lock_guard();
drop function if exists public.sample_seed_guard(uuid);
drop function if exists public.tenant_real_record_count(uuid);

create or replace function public.purge_tenant_sample_data(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  if p_tenant_id is null then
    raise exception 'ofis kimligi gerekli' using errcode = '22023';
  end if;

  -- Yetki: service_role ya da ofisin owner/gm uyesi. Baska rol / baska ofis -> hata (sessiz bosluk yok).
  if not v_is_service then
    if v_uid is null or not exists (
      select 1 from public.profiles p
      where p.id = v_uid and p.tenant_id = p_tenant_id and p.is_active and p.role in ('owner', 'gm')
    ) then
      raise exception 'Bu islem yalniz ofis sahibi veya genel mudur tarafindan yapilabilir.' using errcode = '42501';
    end if;
  end if;

  -- Sira: bagimli -> ana. Her satir yalniz ornek (is_sample = true) ve bu ofis (tenant_id = p_tenant_id).
  delete from public.rent_charges
    where tenant_id = p_tenant_id
      and rental_id in (select r.id from public.rentals r where r.is_sample = true and r.tenant_id = p_tenant_id);
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('rent_charges', v_n);

  delete from public.commissions where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('commissions', v_n);

  delete from public.contracts where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('contracts', v_n);

  delete from public.deals where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('deals', v_n);

  delete from public.offers where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('offers', v_n);

  delete from public.rentals where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('rentals', v_n);

  delete from public.expenses where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('expenses', v_n);

  delete from public.calls where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('calls', v_n);

  delete from public.notifications where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('notifications', v_n);

  delete from public.tasks where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('tasks', v_n);

  delete from public.appointments where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('appointments', v_n);

  delete from public.customer_demands where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('customer_demands', v_n);

  delete from public.property_control_state where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('property_control_state', v_n);

  delete from public.properties where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('properties', v_n);

  delete from public.customers where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('customers', v_n);

  -- Ofis damgasi: ornek veri yok, gercek kullanima gecildi.
  update public.tenants
     set sample_seeded_at = null,
         sample_pack = null,
         sample_cleared_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where id = p_tenant_id;

  return pg_catalog.jsonb_build_object(
    'tenant_id', p_tenant_id,
    'cleared_at', pg_catalog.now(),
    'deleted', v_counts
  );
end;
$$;

comment on function public.purge_tenant_sample_data(uuid) is
  'Ofisin tum ornek (is_sample=true) kayitlarini FK sirasiyla tek transaction''da siler; gercek kayitlara dokunmaz. Cagiran owner/gm ya da service_role.';

revoke all on function public.purge_tenant_sample_data(uuid) from public, anon;
grant execute on function public.purge_tenant_sample_data(uuid) to authenticated, service_role;

alter table public.communications drop column if exists is_sample;
alter table public.campaigns drop column if exists is_sample;
-- profiles.is_sample 20260816001600'a aittir: DUSURULMEZ.
alter table public.tenants drop column if exists sample_seed_override_by;
alter table public.tenants drop column if exists sample_seed_override_until;
alter table public.tenants drop column if exists real_use_at;
