-- MIGRATION 20261016100200_trp_gm_guard_readonly_support.sql
-- SK10 / B161 + B168 + B189 (2026-10-16): rol izin matrisi yazma korumasi, salt okunura Yardim, tur durumu.
-- Geri alma: supabase/rollbacks/20261016100200_trp_gm_guard_readonly_support.rollback.sql.
-- BAGIMLILIK: tenant_role_permissions + tenant_role_permissions_write (20260722000014 ve sonrasi), permission_defaults,
--   profiles.ui_state + profile_ui_state_mark (20261015045000), auth.role()/auth.uid()/auth.jwt() (GoTrue).
--
-- NE:
--   (1) tenant_role_permissions_write: genel mudur (gm) KENDI rolunun ('gm') satirini yazamaz; 'owner' rol satiri hic
--       yazilamaz (ofis sahibi daima tam yetkili; arayuz zaten duzenletmez). Kural uygulamada TEK yerde:
--       src/lib/access-control/admin-rules.ts canEditRolePermissions (eylem + arayuz ayni kurali kullanir).
--   (2) permission_defaults: readonly -> support:view (Yardim / Destek sayfasi). src/lib/permissions.ts DEFAULT_MATRIX ile
--       birebir (src/lib/permissions-matrix-contract.test.ts kilitler).
--   (3) profile_ui_state_mark SECURITY DEFINER: yalniz auth.uid() satirinin ui_state alani yazilir. Salt okunur kullanicinin
--       tur/davet isareti artik kaydedilir. block_readonly_identity_writes tetikleyici fonksiyonu DEGISMEZ (karar: okunma
--       durumu ve readonly tetikleyicisi); fonksiyon tek deyimlik ui_state guncellemesi boyunca rol iddiasini
--       ('request.jwt.claim.role') 'ui_state_mark' yapar ve hemen geri yukler. Destek oturumu (impersonation) yazmaz.
-- ETKI: (1) siki (gm'nin gm satiri ve herkesin owner satiri yazimi kapanir), (2) ek, (3) davranis (readonly artik yazar).
-- Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenant_role_permissions') is null
     or pg_catalog.to_regclass('public.permission_defaults') is null then
    raise exception 'tenant_role_permissions / permission_defaults yok.';
  end if;
  if pg_catalog.to_regprocedure('public.profile_ui_state_mark(text)') is null then
    raise exception 'profile_ui_state_mark yok; once 20261015045000_profiles_ui_state uygulanmali.';
  end if;
end $$;

-- (1) Rol izin matrisi yazma kapisi -------------------------------------------------------------------------------
drop policy if exists tenant_role_permissions_write on public.tenant_role_permissions;
create policy tenant_role_permissions_write on public.tenant_role_permissions
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) = any (array['owner', 'gm'])
    and role <> 'owner'
    and (role <> 'gm' or (select public.current_profile_role()) = 'owner')
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_profile_role()) = any (array['owner', 'gm'])
    and role <> 'owner'
    and (role <> 'gm' or (select public.current_profile_role()) = 'owner')
  );

-- (2) Salt okunur: Yardim / Destek goruntuleme ---------------------------------------------------------------------
insert into public.permission_defaults (role, module, action)
values ('readonly', 'support', 'view')
on conflict (role, module, action) do nothing;

-- (3) Tur / davet isareti: yalniz kendi satiri, salt okunur dahil ---------------------------------------------------
create or replace function public.profile_ui_state_mark(p_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_prev_role text := current_setting('request.jwt.claim.role', true);
  v_rows integer;
begin
  if v_uid is null or auth.role() is distinct from 'authenticated' then
    return false;
  end if;
  -- Destek oturumu kullanicinin durumunu degistirmez (uygulama da cagirmaz).
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') = 'true' then
    return false;
  end if;
  if p_key is null or p_key !~ '^(tour|nudge):[a-z0-9_-]{1,48}$' then
    raise exception 'Gecersiz arayuz durumu anahtari.' using errcode = '22023';
  end if;

  -- block_readonly_identity_writes yalniz auth.role() = 'authenticated' kimlikleri durdurur. Bu SABIT deyim yalniz
  -- cagiranin KENDI satirinin ui_state alanini degistirir; rol iddiasi deyim boyunca farkli, sonra aynen geri.
  perform set_config('request.jwt.claim.role', 'ui_state_mark', true);
  update public.profiles
     set ui_state = coalesce(ui_state, '{}'::jsonb)
                    || jsonb_build_object(p_key, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   where id = v_uid
     and not (coalesce(ui_state, '{}'::jsonb) ? p_key);
  get diagnostics v_rows = row_count;
  perform set_config('request.jwt.claim.role', coalesce(v_prev_role, ''), true);
  return v_rows > 0;
end;
$function$;

comment on function public.profile_ui_state_mark(text) is
  'SK10: tur/davet isareti; SECURITY DEFINER, yalniz auth.uid() satirinin ui_state alani (salt okunur dahil, destek oturumu haric).';

revoke all on function public.profile_ui_state_mark(text) from public;
revoke all on function public.profile_ui_state_mark(text) from anon;
grant execute on function public.profile_ui_state_mark(text) to authenticated;
