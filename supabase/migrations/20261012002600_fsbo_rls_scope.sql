-- MIGRATION 20261012002600_fsbo_rls_scope.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261012002600_fsbo_rls_scope.rollback.sql
-- BAGIMLILIK: 20261012002400_fsbo_leads.sql, 20261012002500_fsbo_realtime.sql, 20261012001600_insight_close_on_contact.sql,
--   public.current_tenant_id(), public.current_profile_role() (text), public.has_effective_permission().
--
-- AMAC (GUVENLIK2-01 Faz 1 + GUVENLIK2-06): FSBO "kendi + sahipsiz" kapsamini eylem katmanindan (canTouch) veritabanina da tasimak;
--   dogrudan PostgREST ile baska danismanin adayini degistirmeyi, sahiplik/kimlik sutunlarini yazmayi ve ornek isaretli kayit
--   eklemeyi kapatmak; olay-aninda-kapatma RPC'lerine modul izni kapisi eklemek.
-- NE:
--  (a) fsbo_leads_update: USING = src/app/actions/prospecting.ts canTouch (yonetici/takim lideri hepsi; digerleri kendi + sahipsiz)
--      ile src/lib/prospecting/conflict.ts ownershipVerdict'in BIRLESIMI (sahiplik suresi dolmus ya da CLAIM_IDLE_DAYS=14 gun
--      hareketsiz kayit baskasinca devralinabilir; src/lib/prospecting/thresholds.ts). WITH CHECK: sonuc satiri yalniz yonetici
--      ya da sahipsiz/kendi uzerine olabilir.
--  (b) Sutun yetkisi: Postgres'te sutun yetkisi tablo yetkisine EKLENIR; bu yuzden once tablo UPDATE yetkisi geri alinir, sonra yalniz
--      izinli sutunlara verilir. Kapali: id, tenant_id, created_by, created_at, is_sample, pii_purged_at. (service_role etkilenmez.)
--  (c) fsbo_leads_insert: kullanici istemcisi is_sample=true kayit ekleyemez (seed service_role ile yazar).
--  (d) insight_close_fsbo_lead / insight_close_call_priority: izin kapisi (yoksa 0 doner, hata vermez).
-- RISK: dusuk-orta (politika + yetki daralmasi; mevcut eylemlerin yazdigi sutunlar izinli listede).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.fsbo_leads') is null then
    raise notice 'public.fsbo_leads yok; FSBO RLS kapsami atlandi';
    return;
  end if;

  -- (a) UPDATE politikasi
  drop policy if exists fsbo_leads_update on public.fsbo_leads;
  create policy fsbo_leads_update on public.fsbo_leads
    for update to authenticated
    using (
      tenant_id = public.current_tenant_id()
      and public.has_effective_permission('prospecting', 'edit')
      and (
        public.current_profile_role()::text in ('owner', 'gm', 'branch_manager', 'team_lead')
        or assigned_to is null
        or assigned_to = auth.uid()
        or (claim_expires_at is not null and claim_expires_at <= now())
        or last_activity_at <= now() - interval '14 days'
      )
    )
    with check (
      tenant_id = public.current_tenant_id()
      and public.has_effective_permission('prospecting', 'edit')
      and (
        public.current_profile_role()::text in ('owner', 'gm', 'branch_manager', 'team_lead')
        or assigned_to is null
        or assigned_to = auth.uid()
      )
    );

  -- (c) INSERT politikasi: ornek isaretli kayit kullanici istemcisiyle eklenemez
  drop policy if exists fsbo_leads_insert on public.fsbo_leads;
  create policy fsbo_leads_insert on public.fsbo_leads
    for insert to authenticated
    with check (
      tenant_id = public.current_tenant_id()
      and public.has_effective_permission('prospecting', 'create')
      and coalesce(is_sample, false) = false
    );

  -- (b) Sutun yetkisi
  revoke update on public.fsbo_leads from authenticated;
  grant update (
    branch_id, assigned_to, source, portal, external_id, url, title, transaction_type, property_type, price, currency,
    rooms, gross_m2, net_m2, province_id, district_id, location_text, listed_at, first_seen_at, last_seen_at, listing_status,
    owner_name, phone, phone_hash, status, status_changed_at, lost_reason, contact_attempts, last_contact_at, next_action_at,
    last_activity_at, price_drop_count, last_price_drop_pct, last_price_drop_at, relist_of, customer_id, property_id,
    converted_at, claim_expires_at, updated_at, deleted_at
  ) on public.fsbo_leads to authenticated;
end
$$;

-- (d) GUVENLIK2-06: izin kapili kapatma RPC'leri (imza ve donus degismez; son tanim ustune).
create or replace function public.insight_close_fsbo_lead(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_uid is null or v_tenant is null or p_lead_id is null then
    return 0;
  end if;
  if not public.has_effective_permission('prospecting', 'edit') then
    return 0;
  end if;
  if pg_catalog.to_regclass('public.fsbo_leads') is null then
    return 0;
  end if;
  if not exists (
    select 1 from public.fsbo_leads l where l.id = p_lead_id and l.tenant_id = v_tenant
  ) then
    return 0;
  end if;

  update public.insights i
     set valid_until = pg_catalog.now()
   where i.tenant_id = v_tenant
     and i.kind = 'call_priority'
     and i.entity_type = 'fsbo_lead'
     and i.entity_id = p_lead_id
     and i.state in ('new', 'seen', 'snoozed')
     and i.valid_until > pg_catalog.now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.insight_close_fsbo_lead(uuid) from public, anon;
grant execute on function public.insight_close_fsbo_lead(uuid) to authenticated;

-- Cagiranlar farkli modullerden gelir (calls:create, customers:edit, portals:edit, appointments:edit): ortak taban customers:view.
create or replace function public.insight_close_call_priority(p_customer_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_uid is null or v_tenant is null or p_customer_id is null then
    return 0;
  end if;
  if not public.has_effective_permission('customers', 'view') then
    return 0;
  end if;
  if not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant
  ) then
    return 0;
  end if;

  update public.insights i
     set valid_until = pg_catalog.now()
   where i.tenant_id = v_tenant
     and i.kind = 'call_priority'
     and i.entity_type = 'customer'
     and i.entity_id = p_customer_id
     and i.state in ('new', 'seen', 'snoozed')
     and i.valid_until > pg_catalog.now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.insight_close_call_priority(uuid) from public, anon;
grant execute on function public.insight_close_call_priority(uuid) to authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur):
-- select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.fsbo_leads'::regclass and polname in ('fsbo_leads_update','fsbo_leads_insert');
-- select column_name from information_schema.column_privileges where table_name='fsbo_leads' and grantee='authenticated' and privilege_type='UPDATE' order by 1;
-- select proname, pg_get_functiondef(oid) like '%has_effective_permission%' from pg_proc where proname in ('insight_close_fsbo_lead','insight_close_call_priority');
