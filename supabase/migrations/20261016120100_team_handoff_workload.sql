-- MIGRATION 20261016120100_team_handoff_workload.sql
-- B1 / G1 (2026-10-16): ekip is yuku devri TEK transaction'da (team_handoff_workload RPC).
-- Geri alma: supabase/rollbacks/20261016120100_team_handoff_workload.rollback.sql
-- BAGIMLILIK: public.profiles, customers, properties, deals, tasks, appointments, audit_logs,
--   public.current_active_tenant_id(), public.current_profile_role(), public.has_effective_permission(text, text).
--   Istege bagli (yoksa ilgili adim atlanir): public.fsbo_leads, public.listing_pool_entries (+ listing_pool_events),
--   public.pool_assignments.
--
-- AMAC: src/app/actions/team.ts handoffMemberWorkload eskiden kapsamlari tablo tablo PostgREST ile tasiyip hata halinde
--   "en iyi caba" geri ceviriyordu (kismi durum mumkundu). Bu fonksiyon ayni suzgeclerle TUM kapsamlari tek transaction'da
--   tasir; herhangi bir adim hata verirse hicbir sey degismez. Denetim satiri (audit_logs 'team.handoff') ayni transaction'da.
--   Kapsamlar (src/lib/team/handoff.ts HANDOFF_SCOPES ile ayni):
--     customers    : silinmemis musteriler (acik talepler musteriyle tasinir)
--     properties   : silinmemis portfoyler; ayrica bu portfoylerin havuz atamalari (listing_pool_entries 'assigned' satiri
--                    + listing_pool_events 'reassigned', pool_assignments aktif satiri 'reassigned' + devralana yeni aktif satir)
--     deals        : kapanmamis anlasmalar (stage won/lost DISI = workflow-state CLOSED_DEAL_STAGES)
--     tasks        : durumu 'open' gorevler
--     appointments : simdiden sonraki, kapanmamis randevular (completed/cancelled DISI = UNCLOSED_APPOINTMENT_STATUSES)
--     fsbo_leads   : silinmemis, acik sahibinden adaylari (prospecting OPEN_STATUSES: yeni/arandi/randevu/yetki_alindi)
--
-- GUVENLIK: SECURITY DEFINER, search_path bos. Kiraci = current_active_tenant_id() (aktif profil + aktif ofis); devreden ve
--   devralan bu ofiste olmali, devralan aktif olmali. Yetki: team:edit + secilen her kapsam icin modul edit izni
--   (customers/properties/commissions/tasks/appointments/prospecting) — eylem katmaniyla ayni. Ofis sahibinin is yukunu
--   yalniz ofis sahibi devreder. Salt okunur rol has_effective_permission ile zaten yazamaz. anon/public calistiramaz.
-- ETKI: yalniz yeni fonksiyon (ek). Tablo/politika degismez. Kod fonksiyon yokken eski tablo tablo yola duser.

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'customers', 'properties', 'deals', 'tasks', 'appointments', 'audit_logs'] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      raise exception 'public.% yok.', t;
    end if;
  end loop;
  if pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text, text)') is null then
    raise exception 'current_active_tenant_id()/current_profile_role()/has_effective_permission(text,text) yok.';
  end if;
end $$;

create or replace function public.team_handoff_workload(p_from uuid, p_to uuid, p_scopes text[], p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_scopes text[];
  v_scope text;
  v_module text;
  v_source record;
  v_target record;
  v_cust uuid[] := '{}';
  v_prop uuid[] := '{}';
  v_deal uuid[] := '{}';
  v_task uuid[] := '{}';
  v_appt uuid[] := '{}';
  v_fsbo uuid[] := '{}';
  v_pool_props uuid[] := '{}';
  v_pa_props uuid[] := '{}';
  v_pa_pools uuid[] := '{}';
  v_counts jsonb;
  v_ids jsonb;
begin
  if v_uid is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  v_tenant := (select public.current_active_tenant_id());
  v_role := (select public.current_profile_role());
  if v_tenant is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if not (select public.has_effective_permission('team', 'edit')) then
    raise exception 'Bu işlem için ekip düzenleme yetkisi gerekir.' using errcode = '42501';
  end if;

  if p_from is null or p_to is null then
    raise exception 'Devreden ve devralan danışman seçilmelidir.' using errcode = '22023';
  end if;
  if p_from = p_to then
    raise exception 'İş yükü aynı danışmana devredilemez.' using errcode = '22023';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Devir gerekçesi 5-300 karakter olmalıdır.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct s), '{}') into v_scopes from unnest(coalesce(p_scopes, '{}')) as s;
  if cardinality(v_scopes) = 0 then
    raise exception 'Devredilecek en az bir kapsam seçin.' using errcode = '22023';
  end if;
  foreach v_scope in array v_scopes loop
    v_module := case v_scope
      when 'customers' then 'customers'
      when 'properties' then 'properties'
      when 'deals' then 'commissions'
      when 'tasks' then 'tasks'
      when 'appointments' then 'appointments'
      when 'fsbo_leads' then 'prospecting'
    end;
    if v_module is null then
      raise exception 'Geçersiz devir kapsamı.' using errcode = '22023';
    end if;
    if not (select public.has_effective_permission(v_module, 'edit')) then
      raise exception 'Seçilen kalemin devri için ilgili modülde düzenleme yetkisi gerekir.' using errcode = '42501';
    end if;
  end loop;

  select p.id, p.full_name, p.is_active into v_target
  from public.profiles p where p.id = p_to and p.tenant_id = v_tenant;
  if not found then
    raise exception 'Devralan danışman bulunamadı.' using errcode = 'P0002';
  end if;
  if not v_target.is_active then
    raise exception 'Devralan danışman pasif — önce aktifleştirin.' using errcode = '22023';
  end if;

  -- Devreden satiri kilitlenir: ayni danisman icin eszamanli iki devir sirayla calisir.
  select p.id, p.full_name, p.role into v_source
  from public.profiles p where p.id = p_from and p.tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'Devreden danışman bu ofiste bulunamadı.' using errcode = 'P0002';
  end if;
  if v_source.role = 'owner' and v_role is distinct from 'owner' then
    raise exception 'Ofis sahibinin iş yükünü yalnız ofis sahibi devredebilir.' using errcode = '42501';
  end if;

  if 'customers' = any(v_scopes) then
    with m as (
      update public.customers set assigned_to = p_to
      where tenant_id = v_tenant and assigned_to = p_from and deleted_at is null
      returning id
    ) select coalesce(array_agg(id), '{}') into v_cust from m;
  end if;

  if 'properties' = any(v_scopes) then
    with m as (
      update public.properties set assigned_to = p_to, updated_at = now()
      where tenant_id = v_tenant and assigned_to = p_from and deleted_at is null
      returning id
    ) select coalesce(array_agg(id), '{}') into v_prop from m;

    if cardinality(v_prop) > 0 and pg_catalog.to_regclass('public.listing_pool_entries') is not null then
      with m as (
        update public.listing_pool_entries set assigned_to = p_to
        where tenant_id = v_tenant and status = 'assigned' and assigned_to = p_from and property_id = any(v_prop)
        returning id, property_id
      ), ev as (
        insert into public.listing_pool_events (tenant_id, entry_id, event, actor_id, from_profile_id, to_profile_id, reason, detail)
        select v_tenant, m.id, 'reassigned', v_uid, p_from, p_to, left(v_reason, 500), jsonb_build_object('method', 'handoff')
        from m
        returning entry_id
      )
      select coalesce(array_agg(distinct m.property_id), '{}') into v_pool_props from m;
    end if;

    if cardinality(v_prop) > 0 and pg_catalog.to_regclass('public.pool_assignments') is not null then
      with m as (
        update public.pool_assignments set status = 'reassigned'
        where tenant_id = v_tenant and status = 'active' and assigned_to = p_from and property_id = any(v_prop)
        returning property_id, from_pool_id
      ) select coalesce(array_agg(property_id), '{}'), coalesce(array_agg(from_pool_id), '{}') into v_pa_props, v_pa_pools from m;
      if cardinality(v_pa_props) > 0 then
        insert into public.pool_assignments
          (tenant_id, property_id, from_pool_id, assigned_to, previous_assignee, assigned_by, method, reason, status)
        select v_tenant, u.property_id, u.from_pool_id, p_to, p_from, v_uid, 'manual', left('Devir: ' || v_reason, 500), 'active'
        from unnest(v_pa_props, v_pa_pools) as u(property_id, from_pool_id);
      end if;
    end if;
  end if;

  if 'deals' = any(v_scopes) then
    with m as (
      update public.deals set assigned_to = p_to, updated_at = now()
      where tenant_id = v_tenant and assigned_to = p_from and stage::text not in ('won', 'lost')
      returning id
    ) select coalesce(array_agg(id), '{}') into v_deal from m;
  end if;

  if 'tasks' = any(v_scopes) then
    with m as (
      update public.tasks set assigned_to = p_to
      where tenant_id = v_tenant and assigned_to = p_from and status::text = 'open'
      returning id
    ) select coalesce(array_agg(id), '{}') into v_task from m;
  end if;

  if 'appointments' = any(v_scopes) then
    with m as (
      update public.appointments set assigned_to = p_to
      where tenant_id = v_tenant and assigned_to = p_from
        and status::text not in ('completed', 'cancelled') and scheduled_at >= now()
      returning id
    ) select coalesce(array_agg(id), '{}') into v_appt from m;
  end if;

  if 'fsbo_leads' = any(v_scopes) and pg_catalog.to_regclass('public.fsbo_leads') is not null then
    with m as (
      update public.fsbo_leads set assigned_to = p_to
      where tenant_id = v_tenant and assigned_to = p_from and deleted_at is null
        and status in ('yeni', 'arandi', 'randevu', 'yetki_alindi')
      returning id
    ) select coalesce(array_agg(id), '{}') into v_fsbo from m;
  end if;

  v_counts := jsonb_build_object(
    'customers', cardinality(v_cust),
    'properties', cardinality(v_prop),
    'deals', cardinality(v_deal),
    'tasks', cardinality(v_task),
    'appointments', cardinality(v_appt),
    'fsbo_leads', cardinality(v_fsbo),
    'listing_pool', (select count(distinct x) from unnest(v_pool_props || v_pa_props) as x)
  );
  v_ids := jsonb_build_object(
    'customers', to_jsonb(v_cust[1:500]),
    'properties', to_jsonb(v_prop[1:500]),
    'deals', to_jsonb(v_deal[1:500]),
    'tasks', to_jsonb(v_task[1:500]),
    'appointments', to_jsonb(v_appt[1:500]),
    'fsbo_leads', to_jsonb(v_fsbo[1:500])
  );

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    v_tenant, v_uid, 'team.handoff', 'profile', p_from, null,
    jsonb_build_object('to', p_to, 'to_name', v_target.full_name, 'reason', v_reason, 'scopes', to_jsonb(v_scopes), 'via', 'rpc')
      || v_counts
      || jsonb_build_object('moved_ids', v_ids)
  );

  return jsonb_build_object('counts', v_counts, 'ids', v_ids, 'from_name', v_source.full_name, 'to_name', v_target.full_name);
end;
$$;

revoke all on function public.team_handoff_workload(uuid, uuid, text[], text) from public, anon;
grant execute on function public.team_handoff_workload(uuid, uuid, text[], text) to authenticated;

comment on function public.team_handoff_workload(uuid, uuid, text[], text) is
  'B1/G1: ekip is yuku devri (musteri/portfoy+havuz atamasi/acik anlasma/acik gorev/yaklasan randevu/acik sahibinden adayi) tek transaction; team:edit + kapsam modulu edit; audit_logs team.handoff.';
