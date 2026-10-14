-- DG7 Ofis guvenlik politikalari: ofis sahibi kendi ofisinin ACIK oturumlarini gorur ve tekil kapatir.
-- Politika degerleri mevcut tenant_settings deposunda (office.security.*; write_setting RPC); bu dosya yalniz iki
-- service_role RPC'si ekler (AD11 platform_list_staff_sessions / platform_revoke_staff_session deseni). Cagiran
-- (sunucu eylemi) sahip yetkisini dogrular; RPC ofis siniri (profiles.tenant_id) disina cikmaz.
-- Bagimsiz; kod RPC yokken "kurulum bekliyor" der, politika ayarlari RPC'siz de calisir.

create or replace function public.office_list_sessions(p_tenant_id uuid)
returns table (
  session_id uuid,
  user_id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  updated_at timestamptz,
  user_agent text,
  ip text,
  aal text,
  not_after timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null then
    return;
  end if;
  return query
    select s.id, s.user_id, s.created_at, (s.refreshed_at at time zone 'UTC'), s.updated_at,
           left(s.user_agent, 300), host(s.ip), s.aal::text, s.not_after
    from auth.sessions s
    join public.profiles p on p.id = s.user_id
    where p.tenant_id = p_tenant_id
      and p.is_active = true
      and (s.not_after is null or s.not_after > now())
    order by coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) desc nulls last
    limit 500;
end;
$$;

create or replace function public.office_revoke_session(p_tenant_id uuid, p_session_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_session_id is null then
    return false;
  end if;
  select s.user_id into v_user
    from auth.sessions s
    join public.profiles p on p.id = s.user_id
   where s.id = p_session_id and p.tenant_id = p_tenant_id;
  if v_user is null then
    return false;
  end if;
  delete from public.two_factor_verified_sessions where session_id = p_session_id and user_id = v_user;
  delete from auth.sessions s where s.id = p_session_id and s.user_id = v_user;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all privileges on function public.office_list_sessions(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function public.office_revoke_session(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.office_list_sessions(uuid) to service_role;
grant execute on function public.office_revoke_session(uuid, uuid) to service_role;

comment on function public.office_list_sessions(uuid) is
  'Service-role-only (DG7): ofisin aktif kullanicilarinin acik oturumlari (en cok 500).';
comment on function public.office_revoke_session(uuid, uuid) is
  'Service-role-only (DG7): ofis siniri icindeki tek oturumu kapatir (yenileme anahtari gecersiz; erisim JWT''si suresi dolana kadar gecer).';

notify pgrst, 'reload schema';
