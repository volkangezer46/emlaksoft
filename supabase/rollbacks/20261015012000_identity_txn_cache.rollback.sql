-- 20261015012000 geri alma: kimlik fonksiyonlarinin onbelleksiz govdeleri (canli ve gölge zincirinde 2026-10-15 itibariyla
--   md5 esit; pg_get_functiondef ciktisi birebir) + nesil tetikleyicileri ve ident_ctx_bump dusurulur.
--   CREATE OR REPLACE ACL/volatilite/DEFINER'i korur. Islem-yerel app.ctx_* ayarlari islem bitince zaten sifirlanir.
set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'tenants', 'tenant_role_permissions', 'user_permission_overrides', 'permission_defaults',
    'two_factor_verified_sessions', 'platform_staff', 'platform_impersonation_sessions'
  ] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop trigger if exists trg_ident_ctx_bump on public.%I', t);
    execute format('drop trigger if exists trg_ident_ctx_bump_truncate on public.%I', t);
  end loop;
end $$;
drop function if exists public.ident_ctx_bump();

CREATE OR REPLACE FUNCTION public.current_active_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v uuid;
BEGIN
  select p.tenant_id into v
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = auth.uid()
    and p.is_active = true
    and t.status not in ('suspended', 'cancelled')
    and p.tenant_id::text = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')
    and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
    and public.current_session_two_factor_satisfied()
  limit 1;
  IF v IS NOT NULL THEN RETURN v; END IF;

  select t.id into v
  from public.platform_staff ps
  join public.tenants t
    on t.id::text = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')
  where ps.id = auth.uid()
    and ps.is_active = true
    and auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
    and auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'
    and nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'impersonation_session_id'), '')
      = nullif(btrim(auth.jwt() ->> 'session_id'), '')
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
  limit 1;
  RETURN v;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.current_profile_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  tid uuid;
  r text;
BEGIN
  tid := public.current_active_tenant_id();
  select p.role into r
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true
    and p.tenant_id = tid
    and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
  limit 1;
  IF r IS NOT NULL THEN RETURN r; END IF;
  IF tid IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
     AND auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly' THEN
    RETURN 'readonly';
  END IF;
  RETURN '';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_effective_permission(p_module text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  tid uuid;
  prole text;
  uid uuid;
  res boolean;
BEGIN
  tid := public.current_active_tenant_id();
  IF tid IS NULL THEN RETURN false; END IF;
  prole := public.current_profile_role();
  uid := auth.uid();

  -- Readonly is an immutable ceiling for support impersonation. Neither a
  -- tenant role override nor a cross-tenant user override may add writes.
  IF prole = 'readonly' THEN
    RETURN p_action = 'view'
      AND EXISTS (
        select 1 from public.permission_defaults pd
        where pd.role = 'readonly' and pd.module = p_module and pd.action = 'view'
      );
  END IF;

  IF prole <> 'owner' THEN
    res := NULL;
    select p_action = any(u.actions) into res
    from public.user_permission_overrides u
    where u.tenant_id = tid
      and u.user_id = uid
      and u.module = p_module
      and (u.expires_at is null or u.expires_at > now())
    limit 1;
    IF res IS NOT NULL THEN RETURN res; END IF;
  END IF;

  res := NULL;
  select trp.allowed into res
  from public.tenant_role_permissions trp
  where trp.tenant_id = tid
    and trp.role = prole
    and trp.module = p_module
    and trp.action = p_action
  limit 1;
  IF res IS NOT NULL THEN RETURN res; END IF;

  RETURN EXISTS (
    select 1 from public.permission_defaults pd
    where pd.role = prole and pd.module = p_module and pd.action = p_action
  );
END;
$function$
;
