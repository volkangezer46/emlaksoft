-- MIGRATION 20261016040200_admin_search_members.sql
-- SK4 / B120 (2026-10-16): admin komut paleti uyeyi adla VE e-postayla bulsun.
-- Geri alma: supabase/rollbacks/20261016040200_admin_search_members.rollback.sql
-- BAGIMLILIK: public.profiles, public.tenants, auth.users.
--
-- SORUN: /api/admin/search profiles'ta OLMAYAN 'email' sutununu seciyordu; PostgREST 42703 donup uye aramasi adla
--   bile bos kaliyordu (hata yutuluyordu). E-posta yalniz auth.users'ta.
-- COZUM: admin_search_members(p_q, p_limit): ad (profiles.full_name) ya da e-posta (auth.users.email) icinde gecen
--   uyeler; ofis adi ve rol ile. Tam e-posta eslesmesi once. LIKE jokerleri kacirilir. q en az 2 karakter.
-- GUVENLIK: SECURITY DEFINER, search_path=''; YALNIZ service_role (auth.role() kontrolu + EXECUTE yalniz service_role).
--   Cagiran /api/admin/search personel ve 'members' modul kapisindan sonra cagirir. anon/authenticated EXECUTE yok.
-- Idempotent: create or replace + grant/revoke.
set local lock_timeout = '5s';

create or replace function public.admin_search_members(p_q text, p_limit integer default 6)
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  tenant_id uuid,
  tenant_name text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  v_q := left(v_q, 80);
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.full_name, u.email::text, p.role, p.tenant_id, t.name, p.is_active
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.tenants t on t.id = p.tenant_id
    where p.full_name ilike v_like
       or u.email ilike v_like
    order by (lower(u.email::text) = lower(v_q)) desc nulls last, p.is_active desc, p.full_name
    limit v_limit;
end;
$$;

revoke all on function public.admin_search_members(text, integer) from public;
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.admin_search_members(text, integer) from anon';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.admin_search_members(text, integer) from authenticated';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.admin_search_members(text, integer) to service_role';
  end if;
end $$;

