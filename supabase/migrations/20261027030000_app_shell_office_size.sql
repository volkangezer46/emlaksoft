-- MIGRATION 20261027030000_app_shell_office_size.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261027030000_app_shell_office_size.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261027030000_app_shell_office_size.rollback.sql (20261012001100 govdesine doner).
-- BAGIMLILIK: public.app_shell_bootstrap() son govdesi (20261012001100), public.branches (tenant_id, is_active).
--
-- AMAC (PERF-1, kabuk hizi): /app layout'u yonetim rollerinde kabuk RPC'si ve kimlik okumasi BITTIKTEN SONRA ayri
--   getOfficeSize turu (profiles + branches iki head-count) atiyordu: bloklayan kabukta seri bir tur daha. Aktif koltuk
--   sayisi zaten 'usage.seats' (ayni sorgu: profiles tenant_id + is_active); bu dosya 'usage.active_branches' ekler.
--   Kod alan yoksa (eski RPC) eski getOfficeSize turuna duser.
-- GOVDE: canli son tanimin (pg_get_functiondef, 2026-10-27 salt-okunur karsilastirma: 20261012001100 ile birebir) kopyasi
--   + yalniz 'usage.active_branches'. SECURITY INVOKER, search_path = public, pg_temp, STABLE degismedi; RLS aynen gecerli.
-- ETKI: yalniz fonksiyon govdesi (CREATE OR REPLACE); tablo/politika/veri degismez. Ek.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.app_shell_bootstrap()') is null then
    raise exception 'app_shell_bootstrap() yok; once 20261006000400 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.branches') is null then
    raise exception 'public.branches yok.';
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
    -- Aktif platform personeli satiri (yalniz kendi kimligi; RLS platform_staff_self_select). Layout ayri platform_staff turunu atmaz;
    -- yetki karari yine her istekte DB'den (bu RPC) gelir, basliga/cereze dayanmaz. Personel degilse null.
    'platform_staff', (
      select jsonb_build_object('id', s.id, 'email', s.email, 'full_name', s.full_name, 'role', s.role, 'is_active', s.is_active)
      from public.platform_staff s
      where s.id = v_uid and s.is_active
      limit 1
    ),
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
      'customers', (select count(*) from public.customers c where c.tenant_id = v_tenant_id and c.deleted_at is null),
      -- PERF-1: aktif sube sayisi (layout getOfficeSize'in ikinci head-count'u; RLS ayni, INVOKER). Aktif koltuk = 'seats'.
      'active_branches', (select count(*) from public.branches b where b.tenant_id = v_tenant_id and b.is_active)
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
  'Ofis uygulamasi kabugu: profil + tenant ozeti + ham izin override satirlari + modul satirlari + kisisel gizli moduller + paket kullanimi (aktif koltuk/sube dahil) + menu rozet sayimlari tek JSON (SECURITY INVOKER; kimlik auth.uid()).';

revoke all on function public.app_shell_bootstrap() from public, anon;
grant execute on function public.app_shell_bootstrap() to authenticated, service_role;
