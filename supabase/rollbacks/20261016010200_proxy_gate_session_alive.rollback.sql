-- Geri alma: 20261016010200_proxy_gate_session_alive.sql
-- proxy_gate_snapshot 20261007000900 gövdesine döner (session_alive / staff_access alanları düşer; kod alanlar yokken
-- oturum canlılığını "bilinmiyor" sayar ve admin modül kapısını sayfaya bırakır), session_alive düşer. Veri değişmez.
set local lock_timeout = '5s';

create or replace function public.proxy_gate_snapshot(p_user_id uuid, p_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'tenant_id', p.tenant_id,
        'role', p.role,
        'is_active', p.is_active,
        'two_factor_sms', p.two_factor_sms,
        'phone', p.phone,
        'two_factor_version', p.two_factor_version
      )
      from public.profiles p
      where p.id = p_user_id
        and (p_user_id = (select auth.uid()) or (select auth.role()) = 'service_role')
      limit 1
    ),
    'staff', exists (
      select 1 from public.platform_staff s
      where s.id = p_user_id and s.is_active
        and (p_user_id = (select auth.uid()) or (select auth.role()) = 'service_role')
    ),
    'tenant_status', (
      select t.status::text
      from public.tenants t
      where p_tenant_id is not null and t.id = p_tenant_id
      limit 1
    )
  );
$$;

revoke all on function public.proxy_gate_snapshot(uuid, uuid) from public, anon;
grant execute on function public.proxy_gate_snapshot(uuid, uuid) to authenticated, service_role;

comment on function public.proxy_gate_snapshot(uuid, uuid) is
  'Proxy kapilari icin profil + aktif platform personeli + ofis durumu tek turda (SECURITY INVOKER: RLS eski dogrudan okumalarla ayni).';

drop function if exists public.session_alive(uuid);
