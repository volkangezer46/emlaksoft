-- 20261027010100 geri alma: ofis oturumu fonksiyonlari 20261025010000 imzalarina ve govdelerine (authenticated EXECUTE) doner;
-- yeni yardimcilar (actor_ok, peek/release/consume_exact) duser.

set local lock_timeout = '5s';

drop function if exists public.platform_list_office_sessions(uuid, uuid, uuid, integer, boolean);
drop function if exists public.platform_revoke_office_session(uuid, uuid, text, uuid, text, text);
drop function if exists public.platform_revoke_office_user_sessions(uuid, uuid, text, uuid, text, text);
drop function if exists public.platform_consume_approval_exact(uuid, text, text, text, uuid, jsonb);
drop function if exists public.platform_release_approval(uuid, uuid, text);
drop function if exists public.platform_peek_approval(text, text, text, uuid, jsonb);
drop function if exists public.platform_office_session_actor_ok(uuid, boolean);

create or replace function public.platform_list_office_sessions(
  p_tenant_id uuid default null,
  p_user_id uuid default null,
  p_limit integer default 300
)
returns table (
  session_id uuid,
  user_id uuid,
  full_name text,
  role text,
  tenant_id uuid,
  tenant_name text,
  created_at timestamptz,
  last_active_at timestamptz,
  aal text,
  ip_masked text,
  user_agent text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.platform_staff_can((select auth.uid()), 'members', 'view') then
    raise exception 'members modulu gerekli.' using errcode = '42501';
  end if;

  return query
  select s.id,
         s.user_id,
         p.full_name::text,
         p.role::text,
         p.tenant_id,
         t.name::text,
         s.created_at,
         greatest(s.created_at, s.updated_at, (s.refreshed_at at time zone 'UTC'), rt.last_at),
         s.aal::text,
         public.platform_mask_ip(s.ip),
         left(s.user_agent, 300),
         s.not_after
    from auth.sessions s
    join public.profiles p on p.id = s.user_id
    left join public.tenants t on t.id = p.tenant_id
    left join lateral (
      select max(r.updated_at) as last_at, bool_or(coalesce(r.revoked, false) = false) as live
        from auth.refresh_tokens r
       where r.session_id = s.id
    ) rt on true
   where p.tenant_id is not null
     and not exists (select 1 from public.platform_staff ps where ps.id = s.user_id)
     and (s.not_after is null or s.not_after > pg_catalog.now())
     and coalesce(rt.live, false)
     and (p_tenant_id is null or p.tenant_id = p_tenant_id)
     and (p_user_id is null or s.user_id = p_user_id)
   order by 8 desc nulls last, s.id
   limit least(greatest(coalesce(p_limit, 300), 1), 1000);
end;
$$;

-- Yazma kapisi: members:write + taban rol super_admin|ops (src/app/actions/admin-office-sessions.ts ile ayni).
create or replace function public.platform_office_session_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.platform_staff_can((select auth.uid()), 'members', 'write')
     and exists (
       select 1 from public.platform_staff s
        where s.id = (select auth.uid()) and s.is_active = true and s.role in ('super_admin', 'ops')
     );
$$;

create or replace function public.platform_revoke_office_session(p_session_id uuid)
returns table (user_id uuid, tenant_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_tenant uuid;
begin
  if not public.platform_office_session_operator() then
    raise exception 'members yazma yetkisi (super admin / operasyon) gerekli.' using errcode = '42501';
  end if;
  select s.user_id, p.tenant_id
    into v_user, v_tenant
    from auth.sessions s
    join public.profiles p on p.id = s.user_id
   where s.id = p_session_id
     and p.tenant_id is not null
     and not exists (select 1 from public.platform_staff ps where ps.id = s.user_id);
  if v_user is null then
    raise exception 'Oturum bulunamadi.' using errcode = 'P0002';
  end if;

  delete from public.two_factor_verified_sessions v where v.session_id = p_session_id::text;
  delete from auth.sessions s where s.id = p_session_id;
  return query select v_user, v_tenant;
end;
$$;

create or replace function public.platform_revoke_office_user_sessions(p_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not public.platform_office_session_operator() then
    raise exception 'members yazma yetkisi (super admin / operasyon) gerekli.' using errcode = '42501';
  end if;
  if p_user_id is null
     or not exists (select 1 from public.profiles p where p.id = p_user_id and p.tenant_id is not null)
     or exists (select 1 from public.platform_staff ps where ps.id = p_user_id) then
    raise exception 'Ofis kullanicisi bulunamadi.' using errcode = 'P0002';
  end if;

  delete from public.login_challenges c where c.user_id = p_user_id;
  delete from public.two_factor_verified_sessions v where v.user_id = p_user_id;
  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.platform_list_office_sessions(uuid, uuid, integer) from public, anon;
revoke all on function public.platform_office_session_operator() from public, anon;
revoke all on function public.platform_revoke_office_session(uuid) from public, anon;
revoke all on function public.platform_revoke_office_user_sessions(uuid) from public, anon;
grant execute on function public.platform_list_office_sessions(uuid, uuid, integer) to authenticated;
grant execute on function public.platform_office_session_operator() to authenticated;
grant execute on function public.platform_revoke_office_session(uuid) to authenticated;
grant execute on function public.platform_revoke_office_user_sessions(uuid) to authenticated;
