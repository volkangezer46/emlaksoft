-- MIGRATION 20261016100000_scope_rls.sql
-- SK10 / B160 (2026-10-16): kayit KAPSAMI (kendi / takim / sube) ve silinmis kayit gizliligi RLS'e tasinir.
-- Geri alma: supabase/rollbacks/20261016100000_scope_rls.rollback.sql (politikalar 20260802000300 bicimine doner,
--   kapsam fonksiyonlari silinir; veri degismez).
-- BAGIMLILIK: current_active_tenant_id(), current_profile_role(), has_effective_permission() (GUC onbellek deseni),
--   tenant_settings, user_scopes, profiles.team_id / profiles.branch_id, identity_* politikalari (20260802000300).
--
-- NE:
--   * public.scope_context()   : SECURITY DEFINER, STABLE, istek basina GUC onbellekli ('app.ctx_scope'; anahtar
--                                has_effective_permission ile ayni: JWT claim'leri + app.ctx_gen). Sonuc "on|{id,...}",
--                                "on|*" ya da "off|*".
--   * public.scope_owner_ids() : kapsamdaki sahip (assigned_to) kimlikleri; NULL = kisit yok (bayrak kapali, ofis geneli).
--   * public.scope_enforced()  : ofisin 'office.access.scope_enforcement' bayragi bu kullanici icin uygulanıyor mu.
--   * public.scope_allows(uuid): tek satir kontrolu (RPC/uygulama icin); politikalar ayni kurali InitPlan bicimiyle yazar.
--   * customers, properties, deals, customer_demands, tasks, appointments: SELECT / UPDATE (USING) / DELETE politikalarina
--     kapsam kosulu; customers ve properties SELECT/UPDATE'e "silinmis kayit yalniz silme yetkilisine" kosulu.
-- KURAL (uygulama ile TEK tanim: src/lib/access-control/scope-rules.ts getDefaultScopeForRole + scope-cache.ts):
--   owner/gm her zaman ofis geneli; bayrak KAPALIYSA herkes bugunku gibi (fonksiyon "kisit yok" doner, sonuc kumesi degismez).
--   Bayrak ACIKSA: user_scopes satiri yoksa rol varsayilani (branch_manager=sube, team_lead=takim, accounting/readonly=ofis,
--   digerleri=kendi). Takim/sube baglami satirdan, yoksa profilden; baglam yoksa (subesiz sube muduru) fail-closed KENDI.
--   Kendi kaydi: assigned_to kapsam uyesi ya da (sutun varsa) created_by = kullanici. Talep (customer_demands) musterisinin
--   kapsamindan gelir (iliskisiz IN alt sorgusu: deyim basina bir kez, hash ile). Silinmis (deleted_at) musteri/portfoy bayrak aciksa yalniz modulde 'delete' izni olana gorunur
--   (silme/geri alma akislari UPDATE ... WHERE ile SELECT politikasini yeni satira da uygular; bu yuzden silen gorebilmeli).
-- PERFORMANS: kapsam fonksiyonlari politikada yalniz "(select f())" InitPlan bicimiyle cagrilir: deyim basina BIR kez
--   hesaplanir (satir basina fonksiyon cagrisi yok); bayrak kapaliyken satir basina ek is yalniz NULL param kontrolu.
-- BILINEN SINIR (bayrak acikken): kapsamli kullanicinin kaydi kapsami DISINA devretmesi (assigned_to baskasina) SELECT
--   politikasi yeni satira da uygulandigi icin 42501 verir; takim/sube icindeki devir calisir. Bayrak varsayilan KAPALI.
-- WITH CHECK ve INSERT politikalari degismez. notifications / notification_reads'e dokunulmaz (sozlesme h).
-- Idempotent: fonksiyonlar create or replace, politikalar drop if exists + create.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null then
    raise exception 'Kimlik yardimcilari yok; once 20260802000300 ve sonraki kimlik migrationlari uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.user_scopes') is null or pg_catalog.to_regclass('public.tenant_settings') is null then
    raise exception 'user_scopes / tenant_settings yok.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'team_id') then
    raise exception 'profiles.team_id yok; takim migrationi once uygulanmali.';
  end if;
end $$;

create or replace function public.scope_context()
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  k text := md5(
    coalesce(current_setting('request.jwt.claims', true), '') || '|' ||
    coalesce(current_setting('request.jwt.claim.sub', true), '') || '|' ||
    coalesce(current_setting('request.jwt.claim', true), '') || '|' ||
    coalesce(current_setting('app.ctx_gen', true), '')) || ':';
  c text := current_setting('app.ctx_scope', true);
  v_tid uuid;
  v_uid uuid;
  v_role text;
  v_on boolean;
  v_type text;
  v_team uuid;
  v_branch uuid;
  v_ctx uuid;
  v_ids uuid[];
  r text;
begin
  if c is not null and left(c, 33) = k then
    return substr(c, 34);
  end if;

  v_tid := public.current_active_tenant_id();
  v_uid := auth.uid();
  v_role := coalesce(public.current_profile_role(), '');

  <<calc>>
  begin
    -- Oturum/ofis yoksa kapsam kisitlamaz: ana kosul (ofis + modul izni) zaten reddeder. owner/gm daima ofis geneli.
    if v_tid is null or v_uid is null or v_role in ('owner', 'gm') then
      r := 'off|*';
      exit calc;
    end if;

    select (ts.value #>> '{}') = 'true' into v_on
      from public.tenant_settings ts
     where ts.tenant_id = v_tid and ts.key = 'office.access.scope_enforcement';
    if not coalesce(v_on, false) then
      r := 'off|*';
      exit calc;
    end if;

    select us.scope_type, us.team_id, us.branch_id into v_type, v_team, v_branch
      from public.user_scopes us
     where us.tenant_id = v_tid and us.user_id = v_uid
     limit 1;
    if v_type is null then
      v_type := case v_role
        when 'branch_manager' then 'branch'
        when 'team_lead' then 'team'
        when 'accounting' then 'office'
        when 'readonly' then 'office'
        else 'user'
      end;
    end if;
    if v_type in ('office', 'platform') then
      r := 'on|*';
      exit calc;
    end if;

    if v_type = 'team' then
      v_ctx := coalesce(v_team, (select p.team_id from public.profiles p where p.id = v_uid and p.tenant_id = v_tid));
      if v_ctx is not null then
        select array_agg(p.id) into v_ids
          from public.profiles p
         where p.tenant_id = v_tid and p.team_id = v_ctx and p.is_active;
      end if;
    elsif v_type = 'branch' then
      v_ctx := coalesce(v_branch, (select p.branch_id from public.profiles p where p.id = v_uid and p.tenant_id = v_tid));
      if v_ctx is not null then
        select array_agg(p.id) into v_ids
          from public.profiles p
         where p.tenant_id = v_tid and p.branch_id = v_ctx and p.is_active;
      end if;
    end if;

    -- Kendi kaydi her kapsamda dahil; baglam yoksa yalniz kendi (fail-closed).
    v_ids := array(select distinct x from unnest(array_append(coalesce(v_ids, '{}'::uuid[]), v_uid)) as t(x));
    r := 'on|' || v_ids::text;
  end calc;

  perform set_config('app.ctx_scope', k || r, true);
  return r;
end;
$function$;

comment on function public.scope_context() is
  'SK10: kayit kapsami baglami (istek basina GUC onbellekli). "off|*" = kisit yok, "on|*" = ofis geneli (bayrak acik), "on|{...}" = kapsam uyeleri.';

create or replace function public.scope_owner_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v text := split_part(public.scope_context(), '|', 2);
begin
  if v = '*' or v = '' then
    return null;
  end if;
  return v::uuid[];
end;
$function$;

comment on function public.scope_owner_ids() is
  'SK10: kapsamdaki sahip kimlikleri; NULL = kisit yok. Politikalarda yalniz (select public.scope_owner_ids()) bicimiyle.';

create or replace function public.scope_enforced()
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  return split_part(public.scope_context(), '|', 1) = 'on';
end;
$function$;

comment on function public.scope_enforced() is
  'SK10: ofisin kapsam bayragi bu kullaniciya uygulanıyor mu (owner/gm ve bayrak kapali: false).';

create or replace function public.scope_allows(p_owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  ids uuid[] := public.scope_owner_ids();
begin
  return ids is null or (p_owner is not null and p_owner = any (ids));
end;
$function$;

comment on function public.scope_allows(uuid) is
  'SK10: tek kayit sahibi kapsamda mi (bayrak kapaliyken true). Politikalar ayni kurali InitPlan bicimiyle uygular.';

revoke all on function public.scope_context() from public, anon;
revoke all on function public.scope_owner_ids() from public, anon;
revoke all on function public.scope_enforced() from public, anon;
revoke all on function public.scope_allows(uuid) from public, anon;
grant execute on function public.scope_context() to authenticated, service_role;
grant execute on function public.scope_owner_ids() to authenticated, service_role;
grant execute on function public.scope_enforced() to authenticated, service_role;
grant execute on function public.scope_allows(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- customers (sahip: assigned_to / created_by; silinmis kayit kosulu)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists identity_customers_select on public.customers;
create policy identity_customers_select on public.customers
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'view'))
    and ((select not public.scope_enforced())
         or (((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid()))
          and (deleted_at is null
               or (select public.has_effective_permission('customers', 'delete')))))
  );

drop policy if exists identity_customers_update on public.customers;
create policy identity_customers_update on public.customers
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
    and ((select not public.scope_enforced())
         or (((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid()))
          and (deleted_at is null
               or (select public.has_effective_permission('customers', 'delete')))))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'edit'))
  );

drop policy if exists identity_customers_delete on public.customers;
create policy identity_customers_delete on public.customers
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('customers', 'delete'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------------------------------------------
-- properties (sahip: assigned_to / created_by; silinmis kayit kosulu)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists identity_properties_select on public.properties;
create policy identity_properties_select on public.properties
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('properties', 'view'))
    and ((select not public.scope_enforced())
         or (((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid()))
          and (deleted_at is null
               or (select public.has_effective_permission('properties', 'delete')))))
  );

drop policy if exists identity_properties_update on public.properties;
create policy identity_properties_update on public.properties
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('properties', 'edit'))
    and ((select not public.scope_enforced())
         or (((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid()))
          and (deleted_at is null
               or (select public.has_effective_permission('properties', 'delete')))))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('properties', 'edit'))
  );

drop policy if exists identity_properties_delete on public.properties;
create policy identity_properties_delete on public.properties
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('properties', 'delete'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------------------------------------------
-- deals (sahip: assigned_to; modul izni commissions)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists identity_deals_select on public.deals;
create policy identity_deals_select on public.deals
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('commissions', 'view'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])))
  );

drop policy if exists identity_deals_update on public.deals;
create policy identity_deals_update on public.deals
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('commissions', 'edit'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('commissions', 'edit'))
  );

drop policy if exists identity_deals_delete on public.deals;
create policy identity_deals_delete on public.deals
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('commissions', 'delete'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])))
  );

-- ---------------------------------------------------------------------------------------------------------------
-- customer_demands (kapsam musteriden: customers.assigned_to / created_by)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists identity_customer_demands_select on public.customer_demands;
create policy identity_customer_demands_select on public.customer_demands
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('demands', 'view'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or customer_id in (
             select c.id from public.customers c
              where c.assigned_to = any ((select public.scope_owner_ids())::uuid[])
                 or c.created_by = (select auth.uid())
           )))
  );

drop policy if exists identity_customer_demands_update on public.customer_demands;
create policy identity_customer_demands_update on public.customer_demands
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('demands', 'edit'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or customer_id in (
             select c.id from public.customers c
              where c.assigned_to = any ((select public.scope_owner_ids())::uuid[])
                 or c.created_by = (select auth.uid())
           )))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('demands', 'edit'))
  );

drop policy if exists identity_customer_demands_delete on public.customer_demands;
create policy identity_customer_demands_delete on public.customer_demands
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('demands', 'delete'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or customer_id in (
             select c.id from public.customers c
              where c.assigned_to = any ((select public.scope_owner_ids())::uuid[])
                 or c.created_by = (select auth.uid())
           )))
  );

-- ---------------------------------------------------------------------------------------------------------------
-- tasks (sahip: assigned_to / created_by)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists identity_tasks_select on public.tasks;
create policy identity_tasks_select on public.tasks
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('tasks', 'view'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid())))
  );

drop policy if exists identity_tasks_update on public.tasks;
create policy identity_tasks_update on public.tasks
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('tasks', 'edit'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('tasks', 'edit'))
  );

drop policy if exists identity_tasks_delete on public.tasks;
create policy identity_tasks_delete on public.tasks
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('tasks', 'delete'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------------------------------------------
-- appointments (sahip: assigned_to / created_by)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists identity_appointments_select on public.appointments;
create policy identity_appointments_select on public.appointments
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('appointments', 'view'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid())))
  );

drop policy if exists identity_appointments_update on public.appointments;
create policy identity_appointments_update on public.appointments
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('appointments', 'edit'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid())))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('appointments', 'edit'))
  );

drop policy if exists identity_appointments_delete on public.appointments;
create policy identity_appointments_delete on public.appointments
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('appointments', 'delete'))
    and ((select not public.scope_enforced())
         or ((select public.scope_owner_ids()) is null
           or assigned_to = any ((select public.scope_owner_ids())::uuid[])
           or created_by = (select auth.uid())))
  );
