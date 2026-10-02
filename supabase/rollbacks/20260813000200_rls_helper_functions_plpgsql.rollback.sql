-- GERİ ALMA: 20260813000200_rls_helper_functions_plpgsql.sql uygulanmadan ÖNCE canlıdan alınan tanımlar.
-- Bu dosya migration değildir (supabase/migrations dışında); gerekirse elle çalıştırılır.
begin;

CREATE OR REPLACE FUNCTION public.current_active_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (
      select p.tenant_id
      from public.profiles p
      join public.tenants t on t.id = p.tenant_id
      where p.id = auth.uid()
        and p.is_active = true
        and t.status not in ('suspended', 'cancelled')
        and p.tenant_id::text = nullif(
          btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'),
          ''
        )
        and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
        and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
        and public.current_session_two_factor_satisfied()
      limit 1
    ),
    (
      select t.id
      from public.platform_staff ps
      join public.tenants t
        on t.id::text = nullif(
          btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'),
          ''
        )
      where ps.id = auth.uid()
        and ps.is_active = true
        and auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
        and auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'
        and nullif(
          btrim(auth.jwt() -> 'app_metadata' ->> 'impersonation_session_id'),
          ''
        ) = nullif(btrim(auth.jwt() ->> 'session_id'), '')
        and exists (
          select 1
          from public.platform_impersonation_sessions pis
          where pis.staff_id = auth.uid()
            and pis.auth_session_id = nullif(btrim(auth.jwt() ->> 'session_id'), '')
            and pis.target_tenant_id = t.id
            and pis.expires_at > now()
        )
        and t.status not in ('suspended', 'cancelled')
        and public.current_session_two_factor_satisfied()
      limit 1
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.current_profile_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (
      select p.role
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = public.current_active_tenant_id()
        and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
      limit 1
    ),
    case
      when public.current_active_tenant_id() is not null
        and auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
        and auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'
      then 'readonly'
    end,
    ''
  );
$function$
;

CREATE OR REPLACE FUNCTION public.has_effective_permission(p_module text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select public.current_active_tenant_id() is not null
    and case
      -- Readonly is an immutable ceiling for support impersonation. Neither a
      -- tenant role override nor a cross-tenant user override may add writes.
      when public.current_profile_role() = 'readonly' then
        p_action = 'view'
        and exists (
          select 1
          from public.permission_defaults pd
          where pd.role = 'readonly'
            and pd.module = p_module
            and pd.action = 'view'
        )
      else coalesce(
        case
          when public.current_profile_role() <> 'owner' then (
            select p_action = any(u.actions)
            from public.user_permission_overrides u
            where u.tenant_id = public.current_active_tenant_id()
              and u.user_id = auth.uid()
              and u.module = p_module
              and (u.expires_at is null or u.expires_at > now())
            limit 1
          )
        end,
        (
          select trp.allowed
          from public.tenant_role_permissions trp
          where trp.tenant_id = public.current_active_tenant_id()
            and trp.role = public.current_profile_role()
            and trp.module = p_module
            and trp.action = p_action
          limit 1
        ),
        exists (
          select 1
          from public.permission_defaults pd
          where pd.role = public.current_profile_role()
            and pd.module = p_module
            and pd.action = p_action
        ),
        false
      )
    end;
$function$
;

commit;
