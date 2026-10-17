-- MIGRATION 20261027010100_office_session_rpcs_service_only.sql
-- UYGULANMADI: 20261025010000 (AG1) SONRASI. KOD ILE AYNI pencere (siki): migration once gelirse eski kod imzasi
--   bulunamaz ve Ofis oturumlari sayfasi "okunamadi" der, kapatma "henuz kurulmadi" der (sessizce yetkisiz yurumez);
--   kod once gelirse yeni imza bulunamaz, ayni bos durum. Ikisi ayni yayinda uygulanir.
-- Geri alma: supabase/rollbacks/20261027010100_office_session_rpcs_service_only.rollback.sql (20261025010000 govdeleri).
-- BAGIMLILIK: public.platform_staff_can(uuid,text,text), public.platform_approval_requests (kind session_revoke),
--   public.platform_audit_logs (AD11 ip/user_agent), auth.sessions, public.two_factor_verified_sessions, public.login_challenges.
--
-- NEDEN (denetim SEC-2, F3, F10): platform_list_office_sessions / platform_revoke_office_session /
--   platform_revoke_office_user_sessions authenticated'a acikti. super_admin/ops parolasiyla (TS'deki MFA, adim dogrulamasi,
--   gerekce, dort goz ve denetim kaydi atlanarak) PostgREST'ten dogrudan herhangi bir ofis kullanicisinin oturumu
--   kapatilabiliyordu. Ayrica dort goz izni eylemden ONCE tuketiliyordu: kapatma hata verirse izin yanip gidiyordu.
-- NE YAPAR:
--   1. Uc fonksiyon yeni imzayla yeniden kurulur; EXECUTE YALNIZ service_role. Cagiran personel p_actor_staff_id ile
--      gelir ve SQL'de yeniden denetlenir (aktif + members view/write + taban rol super_admin|ops).
--   2. Kapatma fonksiyonlari gerekceyi (10-300) dogrular; p_approval_id verilirse dort goz iznini AYNI transaction'da
--      tuketir (platform_consume_approval ile ayni kosullar, kimlik birebir), oturumu kapatir ve platform_audit_logs'a
--      TEK satir yazar. Herhangi bir adim hata verirse hepsi geri alinir: izin 'approved' kalir (yeniden kullanilabilir).
--   3. platform_peek_approval: izni TUKETMEDEN dogrular (TS kapisi eylem sarmalayicisi varken bunu kullanir).
--      platform_release_approval: sarmalayicisi olmayan hassas eylem hata verirse tuketilen izni 'approved'a geri dondurur.
--   4. Liste fonksiyonu p_hide_internal ile demo/test (tenants.is_internal) ofislerini sunucu tarafinda gizleyebilir.
-- ETKI: siki (yetki daralir; yeni tablo yok).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.platform_consume_approval(text,text,text,uuid,jsonb)') is null
     or pg_catalog.to_regprocedure('public.platform_staff_can(uuid,text,text)') is null
     or pg_catalog.to_regclass('public.platform_audit_logs') is null
     or pg_catalog.to_regclass('auth.sessions') is null then
    raise exception '20261027010100: once 20261025010000 uygulanmali (platform_consume_approval, platform_staff_can, platform_audit_logs).';
  end if;
end $$;

drop function if exists public.platform_list_office_sessions(uuid, uuid, integer);
drop function if exists public.platform_revoke_office_session(uuid);
drop function if exists public.platform_revoke_office_user_sessions(uuid);
-- Eski (auth.uid() tabanli) kapi yardimcisi artik kullanilmaz.
drop function if exists public.platform_office_session_operator();

-- ---------------------------------------------------------------- personel kapisi (SQL'de yeniden denetim)
create or replace function public.platform_office_session_actor_ok(p_staff_id uuid, p_write boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_staff_id is not null
     and exists (select 1 from public.platform_staff s where s.id = p_staff_id and s.is_active = true)
     and case
       when p_write then public.platform_staff_can(p_staff_id, 'members', 'write')
         and exists (select 1 from public.platform_staff s where s.id = p_staff_id and s.is_active = true and s.role in ('super_admin', 'ops'))
       else public.platform_staff_can(p_staff_id, 'members', 'view')
     end;
$$;

-- ---------------------------------------------------------------- dort goz: tuketmeden dogrula / geri birak
create or replace function public.platform_peek_approval(p_kind text, p_entity_type text, p_entity_id text, p_staff_id uuid, p_payload jsonb)
returns uuid
language sql
stable
set search_path = ''
as $$
  select r.id
    from public.platform_approval_requests r
   where p_kind in ('session_revoke', 'flag_change', 'queue_requeue', 'demo_data', 'impersonation')
     and r.kind = p_kind
     and r.entity_type = p_entity_type
     and r.entity_id = p_entity_id
     and r.requested_by = p_staff_id
     and r.status = 'approved'
     and r.expires_at > pg_catalog.now()
     and r.payload = coalesce(p_payload, '{}'::jsonb)
     and r.decided_by is not null
     and r.decided_by <> p_staff_id
     and exists (select 1 from public.platform_staff d where d.id = r.decided_by and d.is_active = true and d.role = 'super_admin')
   order by r.decided_at asc nulls last
   limit 1;
$$;

-- Sarmalayicisi olmayan hassas eylem hata verince: tuketilen izin yeniden kullanilabilir olur (executed -> approved).
create or replace function public.platform_release_approval(p_id uuid, p_staff_id uuid, p_error text default null)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
begin
  update public.platform_approval_requests
     set status = 'approved',
         executed_at = null,
         result_error = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
   where id = p_id
     and requested_by = p_staff_id
     and status = 'executed'
     and expires_at > pg_catalog.now();
  return found;
end;
$$;

-- Ic yardimci: verilen izni (kimlik birebir) ayni kosullarla tuketir; yoksa ES403.
create or replace function public.platform_consume_approval_exact(
  p_approval_id uuid, p_kind text, p_entity_type text, p_entity_id text, p_staff_id uuid, p_payload jsonb
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  update public.platform_approval_requests r
     set status = 'executed', executed_at = pg_catalog.now()
   where r.id = p_approval_id
     and r.kind = p_kind
     and r.entity_type = p_entity_type
     and r.entity_id = p_entity_id
     and r.requested_by = p_staff_id
     and r.status = 'approved'
     and r.expires_at > pg_catalog.now()
     and r.payload = coalesce(p_payload, '{}'::jsonb)
     and r.decided_by is not null
     and r.decided_by <> p_staff_id
     and exists (select 1 from public.platform_staff d where d.id = r.decided_by and d.is_active = true and d.role = 'super_admin');
  if not found then
    raise exception 'Dort goz onay izni bulunamadi ya da kullanildi.' using errcode = 'ES403';
  end if;
end;
$$;

-- ---------------------------------------------------------------- liste
create or replace function public.platform_list_office_sessions(
  p_actor_staff_id uuid,
  p_tenant_id uuid default null,
  p_user_id uuid default null,
  p_limit integer default 300,
  p_hide_internal boolean default false
)
returns table (
  session_id uuid,
  user_id uuid,
  full_name text,
  role text,
  tenant_id uuid,
  tenant_name text,
  tenant_internal boolean,
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
  if not public.platform_office_session_actor_ok(p_actor_staff_id, false) then
    raise exception 'members modulu gerekli.' using errcode = '42501';
  end if;

  return query
  select s.id,
         s.user_id,
         p.full_name::text,
         p.role::text,
         p.tenant_id,
         t.name::text,
         coalesce((pg_catalog.to_jsonb(t) ->> 'is_internal')::boolean, false),
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
     and (not coalesce(p_hide_internal, false) or coalesce((pg_catalog.to_jsonb(t) ->> 'is_internal')::boolean, false) = false)
   order by 9 desc nulls last, s.id
   limit least(greatest(coalesce(p_limit, 300), 1), 1000);
end;
$$;

-- ---------------------------------------------------------------- tek oturum kapat
create or replace function public.platform_revoke_office_session(
  p_session_id uuid,
  p_actor_staff_id uuid,
  p_reason text,
  p_approval_id uuid default null,
  p_ip text default null,
  p_user_agent text default null
)
returns table (user_id uuid, tenant_id uuid, audit_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_tenant uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_audit uuid;
begin
  if not public.platform_office_session_actor_ok(p_actor_staff_id, true) then
    raise exception 'members yazma yetkisi (super admin / operasyon) gerekli.' using errcode = '42501';
  end if;
  if pg_catalog.char_length(v_reason) < 10 or pg_catalog.char_length(v_reason) > 300 then
    raise exception 'Gerekce 10-300 karakter olmali.' using errcode = '22023';
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

  if p_approval_id is not null then
    perform public.platform_consume_approval_exact(
      p_approval_id, 'session_revoke', 'auth_session', p_session_id::text, p_actor_staff_id,
      pg_catalog.jsonb_build_object('session_id', p_session_id::text)
    );
  end if;

  delete from public.two_factor_verified_sessions v where v.session_id = p_session_id::text;
  delete from auth.sessions s where s.id = p_session_id;

  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, meta, ip, user_agent)
  values (
    p_actor_staff_id, 'platform_member.session_revoke_one', 'profile', v_user,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'tenant_id', v_tenant,
      'session', left(p_session_id::text, 8),
      'reason', v_reason,
      'via', 'ofis_oturumlari',
      'four_eyes_approval_id', p_approval_id
    )),
    left(p_ip, 64), left(p_user_agent, 400)
  )
  returning id into v_audit;

  return query select v_user, v_tenant, v_audit;
end;
$$;

-- ---------------------------------------------------------------- kullanicinin tum oturumlari
create or replace function public.platform_revoke_office_user_sessions(
  p_user_id uuid,
  p_actor_staff_id uuid,
  p_reason text,
  p_approval_id uuid default null,
  p_ip text default null,
  p_user_agent text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.platform_office_session_actor_ok(p_actor_staff_id, true) then
    raise exception 'members yazma yetkisi (super admin / operasyon) gerekli.' using errcode = '42501';
  end if;
  if pg_catalog.char_length(v_reason) < 10 or pg_catalog.char_length(v_reason) > 300 then
    raise exception 'Gerekce 10-300 karakter olmali.' using errcode = '22023';
  end if;
  if p_user_id is null
     or not exists (select 1 from public.profiles p where p.id = p_user_id and p.tenant_id is not null)
     or exists (select 1 from public.platform_staff ps where ps.id = p_user_id) then
    raise exception 'Ofis kullanicisi bulunamadi.' using errcode = 'P0002';
  end if;

  if p_approval_id is not null then
    perform public.platform_consume_approval_exact(
      p_approval_id, 'session_revoke', 'profile', p_user_id::text, p_actor_staff_id,
      pg_catalog.jsonb_build_object('id', p_user_id::text)
    );
  end if;

  delete from public.login_challenges c where c.user_id = p_user_id;
  delete from public.two_factor_verified_sessions v where v.user_id = p_user_id;
  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_count = row_count;

  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, meta, ip, user_agent)
  values (
    p_actor_staff_id, 'platform_member.sessions_revoke', 'profile', p_user_id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'reason', v_reason,
      'count', v_count,
      'via', 'ofis_oturumlari',
      'four_eyes_approval_id', p_approval_id
    )),
    left(p_ip, 64), left(p_user_agent, 400)
  );
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- yetkiler: YALNIZ service_role
revoke all on function public.platform_office_session_actor_ok(uuid, boolean) from public;
revoke all on function public.platform_peek_approval(text, text, text, uuid, jsonb) from public;
revoke all on function public.platform_release_approval(uuid, uuid, text) from public;
revoke all on function public.platform_consume_approval_exact(uuid, text, text, text, uuid, jsonb) from public;
revoke all on function public.platform_list_office_sessions(uuid, uuid, uuid, integer, boolean) from public;
revoke all on function public.platform_revoke_office_session(uuid, uuid, text, uuid, text, text) from public;
revoke all on function public.platform_revoke_office_user_sessions(uuid, uuid, text, uuid, text, text) from public;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.platform_office_session_actor_ok(uuid, boolean)',
    'public.platform_peek_approval(text, text, text, uuid, jsonb)',
    'public.platform_release_approval(uuid, uuid, text)',
    'public.platform_consume_approval_exact(uuid, text, text, text, uuid, jsonb)',
    'public.platform_list_office_sessions(uuid, uuid, uuid, integer, boolean)',
    'public.platform_revoke_office_session(uuid, uuid, text, uuid, text, text)',
    'public.platform_revoke_office_user_sessions(uuid, uuid, text, uuid, text, text)'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function ' || f || ' from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on function ' || f || ' from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function ' || f || ' to service_role';
    end if;
  end loop;
end $$;

comment on function public.platform_list_office_sessions(uuid, uuid, uuid, integer, boolean) is
  '20261027010100: yalniz service_role; p_actor_staff_id members view ile SQL''de yeniden denetlenir. Maskeli IP, kirpilmis UA; belirtec yok.';
comment on function public.platform_revoke_office_session(uuid, uuid, text, uuid, text, text) is
  '20261027010100: yalniz service_role; personel (members:write + super admin/operasyon) + gerekce SQL''de; dort goz izni, kapatma ve denetim satiri tek transaction.';
comment on function public.platform_revoke_office_user_sessions(uuid, uuid, text, uuid, text, text) is
  '20261027010100: yalniz service_role; personel + gerekce SQL''de; dort goz izni, kapatma ve denetim satiri tek transaction.';
