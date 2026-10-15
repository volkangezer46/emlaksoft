-- MIGRATION 20261016010200_proxy_gate_session_alive.sql
-- SK1 / B019 + B122 (2026-10-16): proxy kapı anlık görüntüsüne oturum canlılığı ve personel yetki öznesi.
-- Geri alma: supabase/rollbacks/20261016010200_proxy_gate_session_alive.rollback.sql
--
-- NEDEN: proxy artık erişim JWT'sini Auth sunucusuna gitmeden YEREL doğruluyor (HS256, src/lib/supabase/verified-request.ts).
--   Yerel doğrulama imza + süreyi denetler ama oturumun hâlâ var olduğunu bilemez: başka cihazdan "tüm oturumları kapat",
--   personelin oturum iptali (platform_revoke_user_sessions) ya da çıkış sonrası eski belirteç süresi dolana dek (≤1 sa)
--   geçerdi. Eskiden bunu her istekte /auth/v1/user ağ turu yakalıyordu (p50 57-72 ms).
-- NE YAPAR:
--   * public.session_alive(p_session_id uuid) -> boolean, SECURITY DEFINER: auth.sessions'ta bu kimlikte, ÇAĞIRANIN
--     (auth.uid()) oturumu var mı ve not_after dolmamış mı. Başka kullanıcının oturum kimliği için daima false
--     (oturum kimliği sızdırma/yoklama yüzeyi yok). Yalnız authenticated + service_role çalıştırır.
--   * public.proxy_gate_snapshot(p_user_id, p_tenant_id) aynı imzayla yeniden yazılır (eski alanlar AYNEN):
--       + "session_alive": JWT'deki session_id (auth.jwt()) için session_alive; claim yoksa/biçimi bozuksa null
--         (kod null'ı "bilinmiyor = geç" sayar; service_role çağrısında null).
--       + "staff_access": aktif personelse {role, custom_role_id, custom_role:{id,label,base_role,permissions}} (RLS:
--         personel kendi özel rolünü okur, platform.ts staffFromRow ile aynı kaynak); değilse null. Proxy admin modül
--         kapısını kabuk akmadan bununla çalıştırır (özel rol okunamazsa kod FAIL-CLOSED: yalnız Genel bakış).
--   SECURITY INVOKER kalır: RLS her tabloda eski doğrudan okumalarla birebir aynı; yalnız session_alive DEFINER'dır
--   (authenticated rolü auth şemasını okuyamaz) ve yalnız çağıranın kendi oturumunu yanıtlar.
-- KOD UYUMU: eski kod yeni alanları yok sayar; yeni kod alanlar yoksa (migration öncesi) oturum canlılığını "bilinmiyor"
--   sayar ve modül kapısını atlar (sayfa kapısı aynı yere yollar). Sıra serbest.
-- PERFORMANS: auth.sessions birincil anahtar araması (sessions_pkey) + platform_staff/özel rol pk araması; ek tur yok.
-- VERİ: değişiklik yok. IDEMPOTENT: create or replace.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.platform_staff') is null
     or pg_catalog.to_regclass('public.tenants') is null
     or pg_catalog.to_regclass('public.platform_custom_roles') is null
     or pg_catalog.to_regclass('auth.sessions') is null then
    raise exception '20261016010200: profiles/platform_staff/platform_custom_roles/tenants/auth.sessions yok.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.platform_staff'::regclass and attname = 'custom_role_id' and not attisdropped
  ) then
    raise exception '20261016010200: platform_staff.custom_role_id yok (DG1 migration once uygulanmali).';
  end if;
end
$$;

create or replace function public.session_alive(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_session_id is not null and exists (
    select 1
      from auth.sessions s
     where s.id = p_session_id
       and s.user_id = (select auth.uid())
       and (s.not_after is null or s.not_after > pg_catalog.now())
  );
$$;

revoke all on function public.session_alive(uuid) from public, anon;
grant execute on function public.session_alive(uuid) to authenticated, service_role;

comment on function public.session_alive(uuid) is
  'SK1: cagiranin (auth.uid) bu oturumu auth.sessions''ta hala var ve suresi dolmamis mi. Proxy yerel JWT dogrulamasinin oturum iptali denetimi.';

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
        -- Kimlik parametresi yalnız çağıranın kendisi olabilir (service_role hariç): başka kullanıcının profili dönmez.
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
    ),
    'session_alive', (
      select case
        when sid.v is null then null
        else public.session_alive(sid.v::uuid)
      end
      from (
        select case
          when (select auth.uid()) is not null
           and p_user_id = (select auth.uid())
           and (select auth.jwt()) ->> 'session_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then (select auth.jwt()) ->> 'session_id'
        end as v
      ) sid
    ),
    'staff_access', (
      select jsonb_build_object(
        'role', s.role,
        'custom_role_id', s.custom_role_id,
        'custom_role', (
          select jsonb_build_object('id', r.id, 'label', r.label, 'base_role', r.base_role, 'permissions', r.permissions)
          from public.platform_custom_roles r
          where s.custom_role_id is not null and r.id = s.custom_role_id
          limit 1
        )
      )
      from public.platform_staff s
      where s.id = p_user_id and s.is_active
        and (p_user_id = (select auth.uid()) or (select auth.role()) = 'service_role')
      limit 1
    )
  );
$$;

revoke all on function public.proxy_gate_snapshot(uuid, uuid) from public, anon;
grant execute on function public.proxy_gate_snapshot(uuid, uuid) to authenticated, service_role;

comment on function public.proxy_gate_snapshot(uuid, uuid) is
  'Proxy kapilari icin profil + aktif platform personeli (+ yetki oznesi) + ofis durumu + oturum canliligi tek turda (SECURITY INVOKER; session_alive DEFINER).';
