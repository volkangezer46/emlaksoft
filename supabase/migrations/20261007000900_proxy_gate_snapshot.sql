-- Proxy kapı anlık görüntüsü: profil + platform personeli + ofis durumu TEK RPC'de (PB53 hız).
--
-- NEDEN: src/lib/supabase/middleware.ts her /app ve /admin isteğinde üç ayrı PostgREST okuması yapıyordu
--   (profiles, platform_staff, tenants; Server-Timing `proxy-gates`). Bunlar tek bir SECURITY INVOKER RPC'de birleşir:
--   3 HTTP turu -> 1. SECURITY INVOKER olduğu için RLS her tabloda ESKİ doğrudan okumalarla birebir aynı uygulanır
--   (yetki genişlemez; çağıranın göremediği satır dönmez). Kod, RPC yokken (PGRST202/42883) eski üç sorguya sessizce düşer.
-- RPC proxy_gate_snapshot(p_user_id uuid, p_tenant_id uuid) -> jsonb:
--   { "profile": {tenant_id, role, is_active, two_factor_sms, phone, two_factor_version} | null,
--     "staff": boolean   (aktif platform_staff satırı görünüyor mu),
--     "tenant_status": text | null   (p_tenant_id null ya da satır görünmüyorsa null) }
--   Bakım/kayıt bayrakları anonim de okunduğundan ayrı, önbellekli yolda kalır (platform-flags-cache).
-- BAGIMLILIK: profiles, platform_staff, tenants tabloları.
-- GERI ALMA: rollbacks/20261007000900_proxy_gate_snapshot.rollback.sql (yalnız fonksiyon düşer; kod eski yola düşer).
-- RISK: düşük (yeni salt-okunur INVOKER fonksiyon; mevcut nesne değişmez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.platform_staff') is null
     or pg_catalog.to_regclass('public.tenants') is null then
    raise exception '20261007000900: profiles/platform_staff/tenants tablolari yok.';
  end if;
end
$$;

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
      limit 1
    ),
    'staff', exists (
      select 1 from public.platform_staff s
      where s.id = p_user_id and s.is_active
    ),
    'tenant_status', (
      select t.status::text
      from public.tenants t
      where p_tenant_id is not null and t.id = p_tenant_id
      limit 1
    )
  );
$$;

revoke all on function public.proxy_gate_snapshot(uuid, uuid) from public, anon;
grant execute on function public.proxy_gate_snapshot(uuid, uuid) to authenticated, service_role;

comment on function public.proxy_gate_snapshot(uuid, uuid) is
  'Proxy kapilari icin profil + aktif platform personeli + ofis durumu tek turda (SECURITY INVOKER: RLS eski dogrudan okumalarla ayni).';

notify pgrst, 'reload schema';
