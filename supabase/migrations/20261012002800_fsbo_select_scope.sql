-- MIGRATION 20261012002800_fsbo_select_scope.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261012002800_fsbo_select_scope.rollback.sql
-- BAGIMLILIK: 20261012002400_fsbo_leads.sql, 20261012002600_fsbo_rls_scope.sql (UPDATE politikasi + sutun listesi bu dosyada ustune kurulur),
--   public.current_tenant_id(), public.current_profile_role() (text), public.has_effective_permission().
--
-- AMAC (GUVENLIK2-01 SELECT fazi): fsbo_leads okuma kapsamini uygulamadaki danisman kapsamiyla esitlemek. Simdiye kadar kiraci
--   genelinde okuma acikti; dogrudan PostgREST ile baska danismanin ilan sahibi adi/telefonu okunabiliyordu (realtime dahil).
-- NE:
--  (a) fsbo_leads_select: yonetici/takim lideri/cagri merkezi ofis geneli; danisman kendi + sahipsiz + kendi olusturdugu.
--      Realtime (Postgres Changes) ayni SELECT politikasina tabidir: baska danismanin satiri (telefon/ad dahil) yayinda ona gitmez.
--  (b) fsbo_lead_observations / fsbo_lead_activities SELECT: kayit gorunen lead'e baglanmak zorunda (not/fiyat gecmisi sizmaz).
--  (c) fsbo_find_existing(p_url_hash, p_phone_hash, p_phone_hash_alt): ofis ici tekillestirme icin RLS'i delmeden dar SECURITY DEFINER
--      okuma. YALNIZ var/yok + sahip adi + sahiplik hesabi icin gereken tarihler doner; telefon/ilan sahibi adi/fiyat DONMEZ.
--  (d) fsbo_assign_lead / fsbo_archive_lead: atama ve arsiv yetki + kapsam KONTROLU ICERIDE. Bu RPC'lere gecildigi icin
--      assigned_to ve deleted_at sutunlarinin kullanici UPDATE yetkisi kaldirilir (002600 sutun listesinden dusurulur).
-- RISK: orta (okuma daralir; kod ayni surumde RPC'lere gecer; migration kodla birlikte yayinlanir).

set local lock_timeout = '5s';

-- Rol yardimcisi: ofis geneli gorunurluk.
create or replace function public.fsbo_office_wide_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.current_profile_role()::text, '') in ('owner', 'gm', 'branch_manager', 'team_lead', 'call_center')
$$;

-- Atama/arsiv yoneticileri (yazma): call_center dahil DEGIL (uygulama canTouch ile ayni).
create or replace function public.fsbo_manage_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.current_profile_role()::text, '') in ('owner', 'gm', 'branch_manager', 'team_lead')
$$;

revoke all on function public.fsbo_office_wide_role() from public, anon;
grant execute on function public.fsbo_office_wide_role() to authenticated;
revoke all on function public.fsbo_manage_role() from public, anon;
grant execute on function public.fsbo_manage_role() to authenticated;

do $$
begin
  if pg_catalog.to_regclass('public.fsbo_leads') is null then
    raise notice 'public.fsbo_leads yok; FSBO SELECT kapsami atlandi';
    return;
  end if;

  -- (a) SELECT politikasi
  drop policy if exists fsbo_leads_select on public.fsbo_leads;
  create policy fsbo_leads_select on public.fsbo_leads
    for select to authenticated
    using (
      tenant_id = public.current_tenant_id()
      and public.has_effective_permission('prospecting', 'view')
      and (
        public.fsbo_office_wide_role()
        or assigned_to is null
        or assigned_to = auth.uid()
        or created_by = auth.uid()
      )
    );

  -- (b) alt tablolar: yalniz gorunen lead'in kayitlari (alt sorgu fsbo_leads RLS'ine tabidir)
  drop policy if exists fsbo_observations_select on public.fsbo_lead_observations;
  create policy fsbo_observations_select on public.fsbo_lead_observations
    for select to authenticated
    using (
      tenant_id = public.current_tenant_id()
      and public.has_effective_permission('prospecting', 'view')
      and exists (select 1 from public.fsbo_leads l where l.id = lead_id and l.tenant_id = fsbo_lead_observations.tenant_id)
    );
  drop policy if exists fsbo_activities_select on public.fsbo_lead_activities;
  create policy fsbo_activities_select on public.fsbo_lead_activities
    for select to authenticated
    using (
      tenant_id = public.current_tenant_id()
      and public.has_effective_permission('prospecting', 'view')
      and exists (select 1 from public.fsbo_leads l where l.id = lead_id and l.tenant_id = fsbo_lead_activities.tenant_id)
    );

  -- (d) sutun yetkisi: 002600 listesi - assigned_to - deleted_at
  revoke update on public.fsbo_leads from authenticated;
  grant update (
    branch_id, source, portal, external_id, url, title, transaction_type, property_type, price, currency,
    rooms, gross_m2, net_m2, province_id, district_id, location_text, listed_at, first_seen_at, last_seen_at, listing_status,
    owner_name, phone, phone_hash, status, status_changed_at, lost_reason, contact_attempts, last_contact_at, next_action_at,
    last_activity_at, price_drop_count, last_price_drop_pct, last_price_drop_at, relist_of, customer_id, property_id,
    converted_at, claim_expires_at, updated_at
  ) on public.fsbo_leads to authenticated;
end
$$;

-- (c) Ofis ici tekillestirme: var/yok + sahip adi. Telefon, ilan sahibi adi, fiyat DONMEZ.
-- p_url_hash = sha256_hex('ext|<portal>|<ilan no>') ya da sha256_hex('url|<baglanti>'); p_phone_hash(+alt) = uygulamanin telefon ozeti (v2, v1).
create or replace function public.fsbo_find_existing(p_url_hash text, p_phone_hash text default null, p_phone_hash_alt text default null)
returns table (
  lead_id uuid,
  match_kind text,
  assigned_to uuid,
  assignee_name text,
  last_activity_at timestamptz,
  claim_expires_at timestamptz,
  status text,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
begin
  if v_uid is null or v_tenant is null then
    return;
  end if;
  if not public.has_effective_permission('prospecting', 'create') then
    return;
  end if;

  if p_url_hash is not null and pg_catalog.length(p_url_hash) = 64 then
    return query
      select l.id, 'url'::text, l.assigned_to,
             (select p.full_name from public.profiles p where p.id = l.assigned_to),
             l.last_activity_at, l.claim_expires_at, l.status,
             (l.assigned_to = v_uid)
        from public.fsbo_leads l
       where l.tenant_id = v_tenant
         and l.deleted_at is null
         and (
           (l.external_id is not null
             and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('ext|' || l.portal || '|' || l.external_id, 'UTF8')), 'hex') = p_url_hash)
           or (l.url is not null
             and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('url|' || l.url, 'UTF8')), 'hex') = p_url_hash)
         )
       limit 1;
  end if;

  if p_phone_hash is not null or p_phone_hash_alt is not null then
    return query
      select l.id, 'phone'::text, l.assigned_to,
             (select p.full_name from public.profiles p where p.id = l.assigned_to),
             l.last_activity_at, l.claim_expires_at, l.status,
             (l.assigned_to = v_uid)
        from public.fsbo_leads l
       where l.tenant_id = v_tenant
         and l.deleted_at is null
         and l.phone_hash is not null
         and (l.phone_hash = p_phone_hash or l.phone_hash = p_phone_hash_alt)
       order by l.last_activity_at desc
       limit 3;
  end if;
end;
$$;

revoke all on function public.fsbo_find_existing(text, text, text) from public, anon;
grant execute on function public.fsbo_find_existing(text, text, text) to authenticated;

-- (d) Atama. Kodlar: ok | denied | not_found | bad_target
create or replace function public.fsbo_assign_lead(p_lead_id uuid, p_assignee uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_lead public.fsbo_leads%rowtype;
begin
  if v_uid is null or v_tenant is null or p_lead_id is null or p_assignee is null then
    return 'denied';
  end if;
  if not public.has_effective_permission('prospecting', 'edit') then
    return 'denied';
  end if;
  select * into v_lead from public.fsbo_leads l where l.id = p_lead_id and l.tenant_id = v_tenant and l.deleted_at is null;
  if not found then
    return 'not_found';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_assignee and p.tenant_id = v_tenant and p.is_active) then
    return 'bad_target';
  end if;

  if not public.fsbo_manage_role() then
    -- Danisman/cagri merkezi: yalniz KENDINE; sahipsiz, kendi, ya da sahipligi dusmus (sure doldu / 14 gun hareketsiz) kayit.
    if p_assignee <> v_uid then
      return 'denied';
    end if;
    if not (
      v_lead.assigned_to is null
      or v_lead.assigned_to = v_uid
      or (v_lead.claim_expires_at is not null and v_lead.claim_expires_at <= pg_catalog.now())
      or v_lead.last_activity_at <= pg_catalog.now() - interval '14 days'
    ) then
      return 'denied';
    end if;
  end if;

  update public.fsbo_leads
     set assigned_to = p_assignee, last_activity_at = pg_catalog.now()
   where id = p_lead_id and tenant_id = v_tenant;
  return 'ok';
end;
$$;

revoke all on function public.fsbo_assign_lead(uuid, uuid) from public, anon;
grant execute on function public.fsbo_assign_lead(uuid, uuid) to authenticated;

-- (d) Arsiv (geri alinabilir). Kodlar: ok | denied | not_found
create or replace function public.fsbo_archive_lead(p_lead_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_lead public.fsbo_leads%rowtype;
begin
  if v_uid is null or v_tenant is null or p_lead_id is null then
    return 'denied';
  end if;
  if not public.has_effective_permission('prospecting', 'delete') then
    return 'denied';
  end if;
  select * into v_lead from public.fsbo_leads l where l.id = p_lead_id and l.tenant_id = v_tenant and l.deleted_at is null;
  if not found then
    return 'not_found';
  end if;
  if not public.fsbo_manage_role() and v_lead.assigned_to is not null and v_lead.assigned_to <> v_uid then
    return 'denied';
  end if;
  update public.fsbo_leads set deleted_at = pg_catalog.now() where id = p_lead_id and tenant_id = v_tenant;
  return 'ok';
end;
$$;

revoke all on function public.fsbo_archive_lead(uuid) from public, anon;
grant execute on function public.fsbo_archive_lead(uuid) to authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur):
-- select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.fsbo_leads'::regclass and polname = 'fsbo_leads_select';
-- select column_name from information_schema.column_privileges where table_name='fsbo_leads' and grantee='authenticated' and privilege_type='UPDATE' order by 1; -- assigned_to / deleted_at OLMAMALI
-- select proname from pg_proc where proname in ('fsbo_find_existing','fsbo_assign_lead','fsbo_archive_lead');
