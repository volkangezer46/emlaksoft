-- MIGRATION 20261006000400_app_shell_bootstrap_rpc.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261006000400_app_shell_bootstrap_rpc.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261006000400_app_shell_bootstrap_rpc.rollback.sql
-- BAGIMLILIK: public.profiles, public.tenants, public.tenant_role_permissions (20260722000014),
--   public.user_permission_overrides (20260726000067), public.tenant_modules (20260816001700),
--   public.tasks, public.approval_requests, public.properties, public.customers, public.current_tenant_id().
--
-- AMAC (PB42 kabuk hizi): /app kabugu (layout) her gezintide 7 ayri PostgREST turu bekliyordu
--   (profil+tenant, rol override, kullanici istisnasi, kapali moduller, 3 kullanim sayimi, 2 rozet sayimi).
--   Bu RPC ayni verileri TEK turda tek JSON olarak dondurur. Kod RPC yoksa/hata verirse eski yola duser
--   (src/lib/app-shell/bootstrap.ts): migration kod deploy'undan sonra uygulanabilir.
--
-- GUVENLIK: SECURITY INVOKER -> her alt sorgu cagiran kullanicinin RLS'iyle calisir (bu RPC hic bir
--   politikayi genisletmez). Kimlik yalniz auth.uid()'den alinir (parametre YOK). Profilin tenant'i JWT
--   tenant'iyla (current_tenant_id) eslesmiyorsa NULL doner; kod eski (dogrulayan) yola duser.
--   Etkin izin BIRLESIMI SQL'de yapilmaz: ham override satirlari doner, birlesim TEK kaynak olan
--   src/lib/permissions-effective.ts (mergeEffectivePermissions) ile yapilir. readonly tavani orada korunur.
--   Rozet sayimlari (geciken gorev, bekleyen onay) yalniz cagiranin kendi kayitlaridir; yetki suzgeci kodda.
--
-- ETKI: yalniz yeni fonksiyon (ek). Tablo/politika/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null or pg_catalog.to_regclass('public.tenants') is null then
    raise exception 'public.profiles/tenants yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.tenant_role_permissions') is null
     or pg_catalog.to_regclass('public.user_permission_overrides') is null then
    raise exception 'tenant_role_permissions/user_permission_overrides yok; once 20260722000014 ve 20260726000067 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.tenant_modules') is null then
    raise exception 'public.tenant_modules yok; once 20260816001700 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.tasks') is null or pg_catalog.to_regclass('public.approval_requests') is null then
    raise exception 'public.tasks/approval_requests yok.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
end $$;

create or replace function public.app_shell_bootstrap()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
  v_role text;
  v_full_name text;
  v_tenant jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select p.tenant_id, p.role, p.full_name
    into v_tenant_id, v_role, v_full_name
  from public.profiles p
  where p.id = v_uid;

  if v_tenant_id is null or v_role is null then
    return null;
  end if;

  -- JWT tenant siniri: profil tenant'i oturumun aktif tenant'iyla eslesmeli (impersonation/degisim durumunda kod yolu dogrular).
  if v_tenant_id is distinct from public.current_tenant_id() then
    return null;
  end if;

  select jsonb_build_object(
           'name', t.name,
           'plan', t.plan,
           'status', t.status,
           'brand_color', t.brand_color,
           'created_at', t.created_at,
           'slug', t.slug,
           'trial_ends_at', t.trial_ends_at
         )
    into v_tenant
  from public.tenants t
  where t.id = v_tenant_id;

  return jsonb_build_object(
    'version', 1,
    'computed_at', now(),
    'profile', jsonb_build_object('id', v_uid, 'full_name', v_full_name, 'role', v_role, 'tenant_id', v_tenant_id),
    'tenant', v_tenant,
    -- Ofise ozel rol override'lari (hucre bazli ekle/cikar) -- birlesim kodda.
    'role_overrides', coalesce((
      select jsonb_agg(jsonb_build_object('module', r.module, 'action', r.action, 'allowed', r.allowed))
      from public.tenant_role_permissions r
      where r.tenant_id = v_tenant_id and r.role = v_role
    ), '[]'::jsonb),
    -- Kullanici istisnalari: owner muaf (kodla ayni kural); suresi gecmis satir donmez.
    'user_overrides', coalesce((
      select jsonb_agg(jsonb_build_object('module', u.module, 'actions', to_jsonb(u.actions), 'expires_at', u.expires_at))
      from public.user_permission_overrides u
      where u.tenant_id = v_tenant_id
        and u.user_id = v_uid
        and v_role <> 'owner'
        and (u.expires_at is null or u.expires_at > now())
    ), '[]'::jsonb),
    -- Modul ac/kapa satirlari (satir yoksa acik; yorum: src/lib/modules/logic.ts).
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object('module_key', m.module_key, 'enabled', m.enabled, 'locked_by_platform', m.locked_by_platform))
      from public.tenant_modules m
      where m.tenant_id = v_tenant_id
    ), '[]'::jsonb),
    -- Paket kullanim kartlari (yan menu): abonelik sayfasi ve entitlement tetikleyicisiyle ayni kapsam.
    'usage', jsonb_build_object(
      'seats', (select count(*) from public.profiles p where p.tenant_id = v_tenant_id and p.is_active),
      'active_properties', (
        select count(*) from public.properties pr
        where pr.tenant_id = v_tenant_id and pr.deleted_at is null and pr.status in ('draft', 'live', 'reserved')
      ),
      'customers', (select count(*) from public.customers c where c.tenant_id = v_tenant_id and c.deleted_at is null)
    ),
    -- Menu rozetleri: yalniz cagiranin kendi geciken gorevleri + onayini bekleyen (kendi talebi haric) talepler.
    'badges', jsonb_build_object(
      'overdue_tasks', (
        select count(*) from public.tasks t
        where t.tenant_id = v_tenant_id and t.assigned_to = v_uid and t.status = 'open' and t.due_at < now()
      ),
      'pending_approvals', (
        select count(*) from public.approval_requests a
        where a.tenant_id = v_tenant_id and a.status = 'bekliyor' and a.requested_by is distinct from v_uid
      )
    )
  );
end;
$$;

comment on function public.app_shell_bootstrap() is
  'Ofis uygulamasi kabugu: profil + tenant ozeti + ham izin override satirlari + modul satirlari + paket kullanimi + menu rozet sayimlari tek JSON (SECURITY INVOKER; kimlik auth.uid()).';

revoke all on function public.app_shell_bootstrap() from public, anon;
grant execute on function public.app_shell_bootstrap() to authenticated, service_role;
