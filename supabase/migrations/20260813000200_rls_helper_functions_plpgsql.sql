-- RLS yardımcı fonksiyonları: SQL → plpgsql. SECURITY DEFINER SQL fonksiyonları satır içi açılamaz ve
-- her çağrıda gövde yeniden ayrıştırılıp planlanır (ölçüm: current_profile_role ≈3,4 ms,
-- has_effective_permission ≈30-40 ms). plpgsql planları oturum boyunca önbelleğe alır ve bağlam
-- (tenant, rol) yerel değişkende bir kez hesaplanır. Anlam birebir aynıdır (eşdeğerlik testi).

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
$function$;

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
$function$;

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
$function$;
