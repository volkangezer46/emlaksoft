-- MIGRATION 20261025010000_admin_sensitive_four_eyes_office_sessions.sql
-- UYGULANMADI: 20261014001300 (DG1 dort goz kuyrugu) ve 20261014021010 (platform_staff_can) SONRASI. KOD ILE AYNI pencere
--   onerilir; kod once gelirse: hassas islem dort goz ayarlari varsayilan KAPALI oldugu icin davranis degismez, ayar acilirsa
--   talep yazilamaz ve islem "kurulum bekliyor" der (sessizce tek imzayla yurumez); Ofis oturumlari sayfasi "veritabani
--   guncellemesi bekliyor" der.
-- Geri alma: supabase/rollbacks/20261025010000_admin_sensitive_four_eyes_office_sessions.rollback.sql
-- BAGIMLILIK: public.platform_approval_requests, public.platform_staff_can(uuid,text,text), public.profiles, public.tenants,
--   public.platform_staff, public.two_factor_verified_sessions, public.login_challenges, auth.sessions, auth.refresh_tokens.
--
-- NE:
--   1) Dort goz kuyruguna HASSAS islem turleri (izin modeli, "grant"): session_revoke (oturum kapatma), flag_change (ofis
--      bazinda bayrak), queue_requeue (kuyruk yeniden deneme), demo_data (demo zorla temizleme / yeniden yukleme / sifirlama),
--      impersonation (ofise destek erisimi). Modul listesine members ve sistem eklenir. Mevcut turler ve satirlar degismez.
--   2) public.platform_consume_approval(kind, entity_type, entity_id, staff, payload) -> uuid: talep edenin ONAYLANMIS ve
--      suresi gecmemis talebini TEK SEFER tuketir (approved -> executed, satir kilidi + kosullu guncelleme; ikinci cagri null).
--      Yuk (payload) birebir esit olmali (onaylanan islemden farkli bir islem tuketemez); onaylayan aktif SUPER ADMIN olmali ve
--      talep edenden farkli olmali (CHECK zaten engeller). Yalniz hassas turler. Yalniz service_role.
--   3) Platform geneli ofis kullanicisi oturumlari (Guvenlik & veri > Ofis oturumlari):
--      platform_list_office_sessions(p_tenant_id, p_user_id, p_limit): SECURITY DEFINER; yalniz members modulunu GORUNTULEYEN
--        aktif platform personeli (auth.uid()). Doner: oturum kimligi, kullanici, rol, ofis, son etkinlik, AAL, MASKELI IP
--        (a.b.x.x / ilk iki IPv6 grubu), kirpilmis user agent, bitis. Belirtec, refresh token, HMAC anahtari ve tam IP ASLA
--        donmez. Platform personelinin kendi oturumlari listelenmez.
--      platform_revoke_office_session(p_session_id): tek oturumu kapatir (auth.sessions satiri; refresh_tokens FK ile duser,
--        2FA oturum kaydi silinir). platform_revoke_office_user_sessions(p_user_id): kullanicinin tum oturumlari.
--        Ikisi de members:write + taban rol super_admin|ops (uygulama kapisiyla ayni); yalniz ofis kullanicisi hedeflenir.
-- RLS: yeni tablo yok. platform_approval_requests RLS acik + FORCE (degismedi).
-- RISK: dusuk (CHECK genisler; yeni fonksiyonlar; mevcut govdeler degismez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.platform_approval_requests') is null
     or pg_catalog.to_regprocedure('public.platform_staff_can(uuid,text,text)') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.tenants') is null
     or pg_catalog.to_regclass('public.platform_staff') is null
     or pg_catalog.to_regclass('public.two_factor_verified_sessions') is null
     or pg_catalog.to_regclass('public.login_challenges') is null
     or pg_catalog.to_regclass('auth.sessions') is null
     or pg_catalog.to_regclass('auth.refresh_tokens') is null then
    raise exception '20261025010000: once 20261014001300 (dort goz) ve 20261014021010 (platform_staff_can) uygulanmali; auth.sessions/refresh_tokens gerekli.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Hassas islem turleri
-- ---------------------------------------------------------------------------
alter table public.platform_approval_requests drop constraint if exists platform_approval_requests_kind_check;
alter table public.platform_approval_requests add constraint platform_approval_requests_kind_check
  check (kind in ('refund', 'credit_grant', 'office_close', 'staff_role',
                  'session_revoke', 'flag_change', 'queue_requeue', 'demo_data', 'impersonation'));
alter table public.platform_approval_requests drop constraint if exists platform_approval_requests_module_check;
alter table public.platform_approval_requests add constraint platform_approval_requests_module_check
  check (module in ('billing', 'tenants', 'personel', 'members', 'sistem'));

-- Tuketim aramasi: talep edenin onayli izni.
create index if not exists platform_approval_grant_idx
  on public.platform_approval_requests (kind, entity_type, entity_id, requested_by)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- 2) Onayli iznin tek seferlik tuketimi
-- ---------------------------------------------------------------------------
create or replace function public.platform_consume_approval(
  p_kind text,
  p_entity_type text,
  p_entity_id text,
  p_staff_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('session_revoke', 'flag_change', 'queue_requeue', 'demo_data', 'impersonation') then
    return null;
  end if;
  if p_staff_id is null or p_entity_type is null or p_entity_id is null then
    return null;
  end if;

  select r.id
    into v_id
    from public.platform_approval_requests r
   where r.kind = p_kind
     and r.entity_type = p_entity_type
     and r.entity_id = p_entity_id
     and r.requested_by = p_staff_id
     and r.status = 'approved'
     and r.expires_at > pg_catalog.now()
     and r.payload = coalesce(p_payload, '{}'::jsonb)
     and r.decided_by is not null
     and r.decided_by <> p_staff_id
     and exists (
       select 1 from public.platform_staff d
        where d.id = r.decided_by and d.is_active = true and d.role = 'super_admin'
     )
   order by r.decided_at asc nulls last
   limit 1
   for update skip locked;

  if v_id is null then
    return null;
  end if;

  update public.platform_approval_requests
     set status = 'executed', executed_at = pg_catalog.now()
   where id = v_id
     and status = 'approved';
  if not found then
    return null;
  end if;
  return v_id;
end;
$$;

revoke all on function public.platform_consume_approval(text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_consume_approval(text, text, text, uuid, jsonb) to service_role;

comment on function public.platform_consume_approval(text, text, text, uuid, jsonb) is
  'Hassas admin islemi dort goz izni: talep edenin onayli (baska super admin), suresi gecmemis, yuku birebir esit talebini TEK SEFER tuketir (approved -> executed). Yalniz service_role.';

-- ---------------------------------------------------------------------------
-- 3) Ofis kullanicisi oturumlari
-- ---------------------------------------------------------------------------
-- IP maskesi: IPv4 a.b.x.x, IPv6 ilk iki grup. Tam adres fonksiyondan cikmaz.
create or replace function public.platform_mask_ip(p_ip inet)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ip is null then null
    when pg_catalog.family(p_ip) = 4 then
      pg_catalog.split_part(pg_catalog.host(p_ip), '.', 1) || '.' || pg_catalog.split_part(pg_catalog.host(p_ip), '.', 2) || '.x.x'
    else
      pg_catalog.split_part(pg_catalog.host(p_ip), ':', 1) || ':' || pg_catalog.split_part(pg_catalog.host(p_ip), ':', 2) || ':x:x'
  end;
$$;

revoke all on function public.platform_mask_ip(inet) from public, anon;
grant execute on function public.platform_mask_ip(inet) to authenticated, service_role;

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

comment on function public.platform_list_office_sessions(uuid, uuid, integer) is
  'Guvenlik & veri > Ofis oturumlari: members modulunu goren platform personeli icin aktif ofis kullanicisi oturumlari (maskeli IP, kirpilmis UA; belirtec yok).';
comment on function public.platform_revoke_office_session(uuid) is
  'Tek ofis kullanicisi oturumunu kapatir (members:write + super admin/operasyon).';
comment on function public.platform_revoke_office_user_sessions(uuid) is
  'Ofis kullanicisinin tum oturumlarini kapatir (members:write + super admin/operasyon).';
