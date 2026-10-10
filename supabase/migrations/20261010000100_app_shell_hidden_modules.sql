-- MIGRATION 20261010000100_app_shell_hidden_modules.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261010000100_app_shell_hidden_modules.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261010000100_app_shell_hidden_modules.rollback.sql
-- BAGIMLILIK: public.app_shell_bootstrap() (20261006000400), public.user_module_prefs (20261008001200).
--
-- AMAC (sayfa basina bir sunucu turu az): /app layout kabuk RPC'sinden SONRA kisisel modul gizlemeyi
--   (user_module_prefs) ayri bir PostgREST turuyla okuyordu (tenant kabuk RPC'sinden ogrenildigi icin sirali).
--   Ayni veri artik RPC yanitinda 'hidden_modules' (module_key dizisi) olarak gelir. Kod alan yoksa eski okumaya duser.
-- GOVDE: canli son tanimin (pg_get_functiondef, 2026-10-10) BIREBIR kopyasi + yalniz 'hidden_modules' alani.
--   SECURITY INVOKER (varsayilan), search_path = public, pg_temp, STABLE degismedi; RLS aynen gecerli.
-- ETKI: yalniz fonksiyon govdesi (CREATE OR REPLACE); tablo/politika/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.app_shell_bootstrap()') is null then
    raise exception 'app_shell_bootstrap() yok; once 20261006000400 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.user_module_prefs') is null then
    raise exception 'public.user_module_prefs yok; once 20261008001200 uygulanmali.';
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
           'trial_ends_at', t.trial_ends_at,
           'sample_seeded_at', t.sample_seeded_at
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
    -- Kisisel modul gizleme (user_module_prefs; RLS: yalniz kendi satiri). Ayri PostgREST turunu kaldirir.
    'hidden_modules', coalesce((
      select jsonb_agg(h.module_key order by h.module_key)
      from public.user_module_prefs h
      where h.user_id = v_uid and h.tenant_id = v_tenant_id and h.hidden
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
  'Ofis uygulamasi kabugu: profil + tenant ozeti + ham izin override satirlari + modul satirlari + kisisel gizli moduller + paket kullanimi + menu rozet sayimlari tek JSON (SECURITY INVOKER; kimlik auth.uid()).';

revoke all on function public.app_shell_bootstrap() from public, anon;
grant execute on function public.app_shell_bootstrap() to authenticated, service_role;
