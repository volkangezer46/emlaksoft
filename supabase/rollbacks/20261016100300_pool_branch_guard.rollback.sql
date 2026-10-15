-- ROLLBACK 20261016100300_pool_branch_guard.sql
-- assign_pool_entry govdesi 20260823000200 bicimine doner (sube muduru icin sube siniri kalkar). Imza/yetki ayni. Idempotent.

set local lock_timeout = '5s';

create or replace function public.assign_pool_entry(p_entry_id uuid, p_profile_id uuid, p_method text, p_reason text default null::text, p_score smallint default null::smallint, p_detail jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_service boolean := (select auth.role()) = 'service_role';
  v_uid uuid := (select auth.uid());
  v_tenant uuid;
  v_role text;
  v_entry public.listing_pool_entries%rowtype;
  v_prev uuid;
begin
  if p_method not in ('manual', 'suggested', 'auto', 'claim', 'fallback', 'reassign') then
    raise exception 'Gecersiz atama yontemi.' using errcode = '22023';
  end if;

  if v_service then
    select * into v_entry from public.listing_pool_entries where id = p_entry_id for update;
  else
    v_tenant := (select public.current_tenant_id());
    v_role := (select public.current_profile_role());
    if v_tenant is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
    select * into v_entry from public.listing_pool_entries where id = p_entry_id and tenant_id = v_tenant for update;
  end if;
  if not found then raise exception 'Havuz kaydi bulunamadi.' using errcode = 'P0002'; end if;

  if not v_service then
    if p_method in ('auto', 'fallback') then
      raise exception 'Bu yontem yalnizca sistem icindir.' using errcode = '42501';
    elsif p_method = 'claim' then
      if v_uid is distinct from p_profile_id
         or v_entry.claim_open_until is null
         or v_entry.claim_open_until < now()
         or v_entry.claim_open_until > now() + interval '7 days 5 minutes' then
        raise exception 'Sahiplenme suresi acik degil.' using errcode = '42501';
      end if;
      -- Sahiplenme yalnız havuzdaki SAHİPSİZ ilan için: başkasına atanmış ilan bu yolla devralınamaz.
      if not exists (
        select 1 from public.properties p
        where p.id = v_entry.property_id
          and p.tenant_id = v_entry.tenant_id
          and p.assigned_to is null
          and p.deleted_at is null
      ) then
        raise exception 'Bu ilan sahiplenmeye acik degil.' using errcode = '42501';
      end if;
    elsif v_role not in ('owner', 'gm', 'branch_manager') then
      raise exception 'Atama yetkiniz yok.' using errcode = '42501';
    end if;
  end if;

  if p_method = 'reassign' then
    if v_entry.status <> 'assigned' then raise exception 'Yalniz atanmis kayit yeniden atanir.' using errcode = '22023'; end if;
  elsif v_entry.status <> 'pending' then
    raise exception 'Kayit zaten atanmis veya kapanmis.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.tenant_id = v_entry.tenant_id and p.is_active
      and p.role in ('owner', 'gm', 'branch_manager', 'team_lead', 'advisor')
  ) then
    raise exception 'Atanacak kullanici bu ofiste aktif degil.' using errcode = '22023';
  end if;

  v_prev := v_entry.assigned_to;
  update public.properties set assigned_to = p_profile_id
  where id = v_entry.property_id and tenant_id = v_entry.tenant_id;

  update public.listing_pool_entries set
    status = 'assigned',
    assigned_to = p_profile_id,
    assigned_by = case when p_method in ('auto', 'fallback') then null else v_uid end,
    assigned_at = now(),
    assign_method = p_method,
    reason = coalesce(p_reason, reason),
    claim_open_until = null
  where id = v_entry.id;

  insert into public.listing_pool_events
    (tenant_id, entry_id, event, actor_id, from_profile_id, to_profile_id, score, reason, detail)
  values
    (v_entry.tenant_id, v_entry.id,
     case when p_method = 'reassign' then 'reassigned' else 'assigned' end,
     v_uid, v_prev, p_profile_id, p_score, p_reason,
     coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('method', p_method));

  return jsonb_build_object('entry_id', v_entry.id, 'property_id', v_entry.property_id,
                            'assigned_to', p_profile_id, 'method', p_method);
end;
$function$;
