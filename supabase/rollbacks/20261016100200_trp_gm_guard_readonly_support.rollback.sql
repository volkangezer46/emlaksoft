-- ROLLBACK 20261016100200_trp_gm_guard_readonly_support.sql
-- (1) Rol izin yazma politikasi eski bicime (owner/gm her rol satirini yazar), (2) readonly support:view kaldirilir,
-- (3) profile_ui_state_mark SECURITY INVOKER bicimine doner (salt okunur yine yazamaz). Idempotent.
-- NOT: src/lib/permissions.ts DEFAULT_MATRIX.readonly.support ayni anda geri alinmazsa permissions-matrix-contract testi kirilir.

set local lock_timeout = '5s';

drop policy if exists tenant_role_permissions_write on public.tenant_role_permissions;
create policy tenant_role_permissions_write on public.tenant_role_permissions
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) = any (array['owner', 'gm']))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_profile_role()) = any (array['owner', 'gm']));

delete from public.permission_defaults where role = 'readonly' and module = 'support' and action = 'view';

create or replace function public.profile_ui_state_mark(p_key text)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null then
    return false;
  end if;
  if p_key is null or p_key !~ '^(tour|nudge):[a-z0-9_-]{1,48}$' then
    raise exception 'Gecersiz arayuz durumu anahtari.' using errcode = '22023';
  end if;
  update public.profiles
     set ui_state = coalesce(ui_state, '{}'::jsonb)
                    || jsonb_build_object(p_key, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   where id = v_uid
     and not (coalesce(ui_state, '{}'::jsonb) ? p_key);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.profile_ui_state_mark(text) from public;
revoke all on function public.profile_ui_state_mark(text) from anon;
grant execute on function public.profile_ui_state_mark(text) to authenticated;
