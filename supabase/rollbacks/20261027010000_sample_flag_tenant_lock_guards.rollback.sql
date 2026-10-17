-- 20261027010000 geri alma: is_sample yazma kapisi tetikleyicileri ve guvenilir isaret fonksiyonu duser;
-- guard_profile_identity_fields / guard_tenant_lifecycle_fields / current_active_tenant_id 2026-10-27 oncesi canli govdelerine doner.

set local lock_timeout = '5s';

do $$
declare
  r record;
begin
  for r in
    select t.tgrelid::regclass::text as tbl
      from pg_catalog.pg_trigger t
     where t.tgname = 'trg_00_sample_flag_guard' and not t.tgisinternal
  loop
    execute pg_catalog.format('drop trigger if exists trg_00_sample_flag_guard on %s', r.tbl);
  end loop;
end $$;

drop function if exists public.guard_sample_flag_update();

CREATE OR REPLACE FUNCTION public.guard_profile_identity_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if auth.role() in ('anon', 'authenticated') and (
    new.tenant_id is distinct from old.tenant_id
    or new.branch_id is distinct from old.branch_id
    or new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.two_factor_sms is distinct from old.two_factor_sms
    or (
      new.two_factor_version is distinct from old.two_factor_version
      and new.phone is not distinct from old.phone
      and new.two_factor_sms is not distinct from old.two_factor_sms
    )
  ) then
    raise exception 'Identity fields require the trusted server workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_tenant_lifecycle_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if auth.role() in ('anon', 'authenticated') and (
    new.id is distinct from old.id
    or new.slug is distinct from old.slug
    or new.plan is distinct from old.plan
    or new.status is distinct from old.status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.team_size is distinct from old.team_size
    or new.created_at is distinct from old.created_at
    or new.lead_capture_token is distinct from old.lead_capture_token
    or new.sample_seeded_at is distinct from old.sample_seeded_at
  ) then
    raise exception 'Tenant lifecycle fields require the trusted server workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_active_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v uuid;
  k text := md5(
    coalesce(current_setting('request.jwt.claims', true), '') || '|' ||
    coalesce(current_setting('request.jwt.claim.sub', true), '') || '|' ||
    coalesce(current_setting('request.jwt.claim', true), '') || '|' ||
    coalesce(current_setting('app.ctx_gen', true), '')) || ':';
  c text := current_setting('app.ctx_tenant', true);
BEGIN
  IF c IS NOT NULL AND left(c, 33) = k THEN
    RETURN substr(c, 34)::uuid;
  END IF;

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
  IF v IS NOT NULL THEN
    PERFORM set_config('app.ctx_tenant', k || v::text, true);
    RETURN v;
  END IF;

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
  IF v IS NOT NULL THEN
    PERFORM set_config('app.ctx_tenant', k || v::text, true);
  END IF;
  RETURN v;
END;
$function$
;

drop function if exists public.sample_trusted_op(uuid);
