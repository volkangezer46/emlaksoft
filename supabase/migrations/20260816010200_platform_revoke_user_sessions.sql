-- K1: platform personeli, ofis kullanicisi veya platform personelinin ACIK oturumlarini kapatabilsin.
-- revoke_team_member_sessions yalniz PASIF uye icin calisir; bu fonksiyon aktif hesaplarda da kullanilir
-- (parola kaybi, cihaz kaybi, gecici parola atamasi). Yalniz service_role; cagiran yetkiyi sunucuda dogrular.

create or replace function public.platform_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;

  delete from public.login_challenges where user_id = p_user_id;
  delete from public.two_factor_verified_sessions where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all privileges on function public.platform_revoke_user_sessions(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.platform_revoke_user_sessions(uuid) to service_role;

comment on function public.platform_revoke_user_sessions(uuid) is
  'Service-role-only: kullanicinin tum acik oturumlarini ve 2FA oturum kayitlarini siler.';

notify pgrst, 'reload schema';
