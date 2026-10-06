-- Forward-only migration: Kapsam-aware yetkilendirme RPC'leri.
-- SQL tarafında kapsam kontrol, danışman portföy/talep erişimi vb.

-- ===== Helper RPC: Geçerli kullanıcı kapsamını al =====
create or replace function public.current_user_scope()
returns text
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(
    (select scope_type from user_scopes
     where user_id = auth.uid() and tenant_id = public.current_tenant_id()
     limit 1),
    case public.current_profile_role()
      when 'owner' then 'office'::text
      when 'gm' then 'office'::text
      when 'branch_manager' then 'branch'::text
      when 'team_lead' then 'team'::text
      else 'user'::text
    end
  );
$$;

comment on function public.current_user_scope is
  'Geçerli kullanıcının kapsam türünü döndürür (user, team, branch, office, platform)';

-- ===== Helper RPC: Kullanıcının takım ID'si =====
create or replace function public.current_user_team_id()
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select team_id from user_scopes
  where user_id = auth.uid() and tenant_id = public.current_tenant_id()
  limit 1;
$$;

comment on function public.current_user_team_id is
  'Geçerli kullanıcının takım ID''si (team_lead için)';

-- ===== Helper RPC: Kullanıcının şube ID'si =====
create or replace function public.current_user_branch_id()
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select branch_id from user_scopes
  where user_id = auth.uid() and tenant_id = public.current_tenant_id()
  limit 1;
$$;

comment on function public.current_user_branch_id is
  'Geçerli kullanıcının şube ID''si (branch_manager için)';

-- ===== Main RPC: Kapsam-aware yetkilendirme kontrolü =====
create or replace function public.has_permission_with_scope(
  p_module text,
  p_action text,
  p_resource_type text default null,
  p_resource_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_role text;
  v_scope text;
  v_user_id uuid;
  v_tenant_id uuid;
  v_has_permission boolean;
begin
  v_user_id := auth.uid();
  v_tenant_id := public.current_tenant_id();
  v_scope := public.current_user_scope();
  v_role := public.current_profile_role();

  -- Authenticated kontrolü
  if v_user_id is null or v_tenant_id is null then
    return false;
  end if;

  -- 1. Temel rol × modül × aksiyon kontrolü
  v_has_permission := exists(
    select 1 from permission_defaults
    where role = v_role and module = p_module and action = p_action
  );

  if not v_has_permission then
    -- Tenant override kontrolü
    v_has_permission := exists(
      select 1 from tenant_role_permissions
      where tenant_id = v_tenant_id
        and role = v_role
        and module = p_module
        and action = p_action
        and allowed = true
    );
  end if;

  if not v_has_permission then
    return false;
  end if;

  -- 2. Scope kontrol (resource-specific)
  if p_resource_type is not null and p_resource_id is not null then
    -- Danışman talep kontrolü: talep (customer_demands) müşterisi kendisine atanmış olmalı
    if p_resource_type = 'demand' and v_role = 'advisor' and p_action = 'view' then
      return exists(
        select 1
        from customer_demands cd
        join customers c on c.id = cd.customer_id and c.tenant_id = cd.tenant_id
        where cd.id = p_resource_id
          and cd.tenant_id = v_tenant_id
          and (c.assigned_to = v_user_id or c.created_by = v_user_id)
      );
    end if;

    -- Danışman portföy kontrolü: atandığı portföyler
    if p_resource_type = 'property' and v_role = 'advisor' and p_action = 'view' then
      return exists(
        select 1 from properties
        where id = p_resource_id
          and tenant_id = v_tenant_id
          and (assigned_to = v_user_id or created_by = v_user_id)
      );
    end if;

    -- Anlaşma imzalama: talep sahibi, takım lideri, gm/owner
    if p_resource_type = 'deal' and p_action = 'sign' then
      if v_role in ('owner', 'gm', 'branch_manager') then
        return true;
      end if;
      if v_role = 'team_lead' then
        return true;
      end if;
      -- Danışman anlaşmanın sorumlusuysa imzalayabilir
      if v_role = 'advisor' then
        return exists(
          select 1 from deals de
          where de.id = p_resource_id
            and de.tenant_id = v_tenant_id
            and de.assigned_to = v_user_id
        );
      end if;
    end if;

    -- Scope override kontrolü
    if exists(
      select 1 from scope_overrides
      where user_id = v_user_id
        and tenant_id = v_tenant_id
        and resource_type = p_resource_type
        and resource_id = p_resource_id
        and (expires_at is null or expires_at > now())
    ) then
      return (
        select allowed from scope_overrides
        where user_id = v_user_id
          and tenant_id = v_tenant_id
          and resource_type = p_resource_type
          and resource_id = p_resource_id
          and (expires_at is null or expires_at > now())
        limit 1
      );
    end if;
  end if;

  return true;
end;
$$;

comment on function public.has_permission_with_scope is
  'Kapsam-aware yetkilendirme kontrolü. Rol × modül × aksiyon + resource-specific kapsam kuralları.';

grant execute on function public.has_permission_with_scope to authenticated;
grant execute on function public.current_user_scope to authenticated;
grant execute on function public.current_user_team_id to authenticated;
grant execute on function public.current_user_branch_id to authenticated;
