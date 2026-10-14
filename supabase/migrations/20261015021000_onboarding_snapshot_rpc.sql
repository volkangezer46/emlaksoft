-- MIGRATION 20261015021000_onboarding_snapshot_rpc.sql
-- KQ5 (2026-10-15): kurulum durumu (Baslangic sihirbazi, ana ekran Baslangic karti, Ayarlar, Yardim) TEK turda.
-- Geri alma: supabase/rollbacks/20261015021000_onboarding_snapshot_rpc.rollback.sql
-- BAGIMLILIK: tenants, profiles, customers, properties, customer_demands, appointments, definitions,
--   advisor_specialties, advisor_regions, subscriptions, finance_accounts, recurring_rules, tenant_modules,
--   tenant_portal_accounts, eids_inbound_addresses, tenant_integrations (hepsi mevcut).
--
-- AMAC: src/lib/onboarding-state.ts `loadOnboardingSnapshot` her acilista 22 ayri PostgREST sayimi atiyordu. Bu fonksiyon
--   ayni olgulari tek jsonb'de dondurur; yalniz var/yok gereken adimlarda EXISTS kullanilir (tam sayim gerekmez).
--   Tam sayi donenler: customers, properties, sample_customers (ekranda gosterilir); members en cok 2'ye kadar sayilir
--   ("Ekibini davet et" kurali members > 1). Tamamlanma kurallari kodda kalir (onboarding-steps.ts / onboarding-checklist.ts).
--   Sorgu suzgecleri eski koddakiyle birebir ayni: kiraci esitligi yalniz eski kodun koydugu yerde, digerleri RLS ile.
--
-- GUVENLIK: SECURITY INVOKER (RLS cagiranin yetkisiyle). p_tenant_id yalniz DARALTIR (verilmezse current_tenant_id()).
--   tenant_integrations authenticated rolune kapali olabilir (20260731000136 sonrasi kolon izni yok): okunamiyorsa
--   "aktif entegrasyon" olgusu false sayilir, fonksiyon hata vermez.
-- ETKI: yalniz yeni fonksiyon (ek). Tablo/politika/veri degismez. Idempotent (create or replace).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.customers') is null or pg_catalog.to_regclass('public.properties') is null then
    raise exception 'cekirdek tablolar yok.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
end $$;

create or replace function public.onboarding_snapshot(p_tenant_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid := coalesce(p_tenant_id, public.current_tenant_id());
  v_integrations boolean := false;
  v_out jsonb;
begin
  if v_tid is null then
    return null;
  end if;

  -- Kolon izni yoksa sorgu planlanmadan atlanir (plpgsql her ifadeyi calisma aninda planlar).
  if pg_catalog.to_regclass('public.tenant_integrations') is not null
     and has_column_privilege('public.tenant_integrations', 'is_active', 'SELECT')
     and has_column_privilege('public.tenant_integrations', 'provider', 'SELECT') then
    select exists (
      select 1 from public.tenant_integrations ti
      where ti.is_active = true and ti.provider in ('netgsm', 'whatsapp')
    ) into v_integrations;
  end if;

  select jsonb_build_object(
    'tenant', (
      select jsonb_build_object(
        'name', t.name,
        'slug', t.slug,
        'sample_seeded_at', t.sample_seeded_at,
        'plan', t.plan,
        'listing_pool_enabled', t.listing_pool_enabled
      )
      from public.tenants t where t.id = v_tid
    ),
    'customers', (select count(*) from public.customers c where c.is_sample = false),
    'properties', (select count(*) from public.properties p where p.is_sample = false),
    'sample_customers', (select count(*) from public.customers c where c.is_sample = true),
    'members', (select count(*) from (select 1 from public.profiles pr where pr.tenant_id = v_tid limit 2) m),
    'custom_definitions', exists (select 1 from public.definitions d where d.tenant_id = v_tid),
    'published_properties', exists (
      select 1 from public.properties p where p.is_sample = false and p.published_at is not null
    ),
    'demands', exists (select 1 from public.customer_demands cd where cd.is_sample = false),
    'appointments', exists (select 1 from public.appointments a where a.is_sample = false),
    'active_integrations', v_integrations,
    'viewer', case when v_uid is null then null else (
      select jsonb_build_object('title', pr.title, 'role', pr.role) from public.profiles pr where pr.id = v_uid
    ) end,
    'viewer_expertise', v_uid is not null and (
      exists (select 1 from public.advisor_specialties s where s.profile_id = v_uid)
      or exists (select 1 from public.advisor_regions r where r.profile_id = v_uid)
    ),
    'pool_advisor_records', exists (select 1 from public.advisor_specialties s where s.is_sample = false)
      or exists (select 1 from public.advisor_regions r where r.is_sample = false),
    'sub_active', exists (select 1 from public.subscriptions s where s.tenant_id = v_tid and s.status = 'active'),
    'office_cash', exists (
      select 1 from public.finance_accounts fa where fa.owner_scope = 'office' and fa.archived_at is null
    ) or exists (select 1 from public.recurring_rules rr where rr.scope = 'office'),
    'rentals_answered', exists (
      select 1 from public.tenant_modules tm where tm.tenant_id = v_tid and tm.module_key = 'rentals'
    ),
    'portal_declared', exists (
      select 1 from public.tenant_portal_accounts tpa where tpa.tenant_id = v_tid and tpa.source = 'owner_declared'
    ),
    'eids_received', exists (
      select 1 from public.eids_inbound_addresses e
      where e.tenant_id = v_tid and e.revoked_at is null and e.last_received_at is not null
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.onboarding_snapshot(uuid) from public, anon;
grant execute on function public.onboarding_snapshot(uuid) to authenticated, service_role;

comment on function public.onboarding_snapshot(uuid) is
  'KQ5: kurulum sihirbazi olgulari tek turda (SECURITY INVOKER, RLS gecerli). Tamamlanma kurallari kodda (onboarding-steps.ts).';

notify pgrst, 'reload schema';
