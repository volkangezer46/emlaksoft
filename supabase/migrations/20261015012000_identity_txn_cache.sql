-- MIGRATION 20261015012000_identity_txn_cache.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi:
--   scripts/db-shadow-replay.sh + supabase/tests/kq2_identity_cache.test.sql).
-- Geri alma: supabase/rollbacks/20261015012000_identity_txn_cache.rollback.sql (uc govde birebir eski hali; nesil tetikleyicileri dusurulur).
-- BAGIMLILIK: current_active_tenant_id / current_profile_role / has_effective_permission son govdeleri
--   (20261009000300 ve sonrasi; canli ile gölge govdeleri 2026-10-15 itibariyla md5 esit).
--
-- AMAC (KQ2, RLS maliyeti): bir istekte (PostgREST = tek islem) ayni kimlik fonksiyonlari onlarca kez cagrilir: her politika
--   InitPlan'i, her DEFINER yardimcisi, RPC govdeleri. Canli olcum: has_effective_permission ~215 us, current_tenant_id ~39 us.
-- ISLEM ICI ONBELLEK: sonuc `set_config('app.ctx_*', <anahtar>:<deger>, true)` ile ISLEM-YEREL yazilir (islem bitince
--   sifirlanir; havuzlanmis baglantida baska istege tasinmaz). Anahtar = md5(JWT claim metinleri + nesil sayaci):
--     request.jwt.claims | request.jwt.claim.sub | request.jwt.claim | app.ctx_gen
--   Claim degisirse (testler, set_config ile kimlik degistiren kod) anahtar degisir, eski deger kullanilmaz.
--   app.ctx_gen: kimligi belirleyen tablolara (profiles, tenants, tenant_role_permissions, user_permission_overrides,
--   permission_defaults, two_factor_verified_sessions, platform_staff, platform_impersonation_sessions) yazan HER ifadeden
--   sonra (AFTER ... FOR EACH STATEMENT) artar: ayni islemde rol/izin/2FA/askiya alma degisirse sonraki cagri yeniden hesaplar.
-- MANTIK AYNEN KORUNUR: 2FA (current_session_two_factor_satisfied), kiraci durumu, JWT rol/kiraci eslesmesi, destek
--   (readonly) oturumu, izin istisnasi/rol matrisi/varsayilan sirasi DEGISMEZ; yalniz hesaplanan sonuc saklanir.
--   current_active_tenant_id ve current_profile_role yalniz OLUMLU sonucu saklar (NULL / '' her cagrida yeniden hesaplanir:
--   ayni islemde sonradan gecerli hale gelen oturum takilip kalmaz). has_effective_permission kiraci varken true/false saklar.
-- NOT: ayni ifadenin satir tetikleyicileri ifade basindaki kimligi gorur (STABLE anlamiyla ayni); sonraki ifade yeniden hesaplar.
-- ACL / volatilite / paralellik degismez (CREATE OR REPLACE mevcut yetkileri korur). Idempotent.
set local lock_timeout = '5s';

-- ---------- Nesil sayaci (ayni islemde kimlik verisi degisince onbellegi gecersiz kilar) ----------
create or replace function public.ident_ctx_bump()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'app.ctx_gen',
    (coalesce(nullif(pg_catalog.current_setting('app.ctx_gen', true), ''), '0')::bigint + 1)::text,
    true
  );
  return null;
end;
$$;

revoke all on function public.ident_ctx_bump() from public, anon, authenticated;
comment on function public.ident_ctx_bump() is
  'KQ2: kimlik onbellegi nesil sayaci (app.ctx_gen). Kimlik tablolarina yazan her ifadeden sonra artar.';

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'tenants', 'tenant_role_permissions', 'user_permission_overrides', 'permission_defaults',
    'two_factor_verified_sessions', 'platform_staff', 'platform_impersonation_sessions'
  ] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      raise notice 'KQ2: % yok, nesil tetikleyicisi atlandi', t;
      continue;
    end if;
    if not exists (select 1 from pg_catalog.pg_trigger
                   where tgrelid = ('public.' || t)::regclass and tgname = 'trg_ident_ctx_bump') then
      execute format(
        'create trigger trg_ident_ctx_bump after insert or update or delete on public.%I '
        'for each statement execute function public.ident_ctx_bump()', t);
    end if;
    if not exists (select 1 from pg_catalog.pg_trigger
                   where tgrelid = ('public.' || t)::regclass and tgname = 'trg_ident_ctx_bump_truncate') then
      execute format(
        'create trigger trg_ident_ctx_bump_truncate after truncate on public.%I '
        'for each statement execute function public.ident_ctx_bump()', t);
    end if;
  end loop;
end $$;

-- ---------- current_active_tenant_id: govde aynen + olumlu sonuc onbellegi ----------
CREATE OR REPLACE FUNCTION public.current_active_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v uuid;
  k text := md5(
    coalesce(current_setting('request.jwt.claims', true), '') || '|' ||
    coalesce(current_setting('request.jwt.claim.sub', true), '') || '|' ||
    coalesce(current_setting('request.jwt.claim', true), '') || '|' ||
    coalesce(current_setting('app.ctx_gen', true), '')) || ':';
  c text := current_setting('app.ctx_tenant', true);
BEGIN
  IF c IS NOT NULL AND left(c, 33) = k THEN
    RETURN substr(c, 34)::uuid;
  END IF;

  select p.tenant_id into v
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = auth.uid()
    and p.is_active = true
    and t.status not in ('suspended', 'cancelled')
    and p.tenant_id::text = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')
    and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
    and public.current_session_two_factor_satisfied()
  limit 1;
  IF v IS NOT NULL THEN
    PERFORM set_config('app.ctx_tenant', k || v::text, true);
    RETURN v;
  END IF;

  select t.id into v
  from public.platform_staff ps
  join public.tenants t
    on t.id::text = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')
  where ps.id = auth.uid()
    and ps.is_active = true
    and auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
    and auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'
    and nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'impersonation_session_id'), '')
      = nullif(btrim(auth.jwt() ->> 'session_id'), '')
    and exists (
      select 1
      from public.platform_impersonation_sessions pis
      where pis.staff_id = auth.uid()
        and pis.auth_session_id = nullif(btrim(auth.jwt() ->> 'session_id'), '')
        and pis.target_tenant_id = t.id
        and pis.expires_at > now()
    )
    and t.status not in ('suspended', 'cancelled')
    and public.current_session_two_factor_satisfied()
  limit 1;
  IF v IS NOT NULL THEN
    PERFORM set_config('app.ctx_tenant', k || v::text, true);
  END IF;
  RETURN v;
END;
$function$;

-- ---------- current_profile_role: govde aynen + olumlu sonuc onbellegi ----------
CREATE OR REPLACE FUNCTION public.current_profile_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  tid uuid;
  r text;
  k text := md5(
    coalesce(current_setting('request.jwt.claims', true), '') || '|' ||
    coalesce(current_setting('request.jwt.claim.sub', true), '') || '|' ||
    coalesce(current_setting('request.jwt.claim', true), '') || '|' ||
    coalesce(current_setting('app.ctx_gen', true), '')) || ':';
  c text := current_setting('app.ctx_role', true);
BEGIN
  IF c IS NOT NULL AND left(c, 33) = k THEN
    RETURN substr(c, 34);
  END IF;

  tid := public.current_active_tenant_id();
  select p.role into r
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true
    and p.tenant_id = tid
    and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
  limit 1;
  IF r IS NOT NULL THEN
    PERFORM set_config('app.ctx_role', k || r, true);
    RETURN r;
  END IF;
  IF tid IS NOT NULL
     AND auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
     AND auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly' THEN
    PERFORM set_config('app.ctx_role', k || 'readonly', true);
    RETURN 'readonly';
  END IF;
  RETURN '';
END;
$function$;

-- ---------- has_effective_permission: govde aynen + (modul, eylem) basina onbellek ----------
CREATE OR REPLACE FUNCTION public.has_effective_permission(p_module text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  tid uuid;
  prole text;
  uid uuid;
  res boolean;
  k text;
  gname text;
  c text;
BEGIN
  tid := public.current_active_tenant_id();
  IF tid IS NULL THEN RETURN false; END IF;

  -- Onbellek anahtari yalniz guvenli GUC adina donusen modul/eylem adlarinda kullanilir.
  IF p_module !~ '[^a-z0-9_]' AND p_action !~ '[^a-z0-9_]'
     AND length(p_module) BETWEEN 1 AND 40 AND length(p_action) BETWEEN 1 AND 40 THEN
    gname := 'app.ctx_perm_' || p_module || '__' || p_action;
    k := md5(
      coalesce(current_setting('request.jwt.claims', true), '') || '|' ||
      coalesce(current_setting('request.jwt.claim.sub', true), '') || '|' ||
      coalesce(current_setting('request.jwt.claim', true), '') || '|' ||
      coalesce(current_setting('app.ctx_gen', true), '')) || ':';
    c := current_setting(gname, true);
    IF c IS NOT NULL AND left(c, 33) = k THEN
      RETURN substr(c, 34) = 't';
    END IF;
  END IF;

  prole := public.current_profile_role();
  uid := auth.uid();

  <<calc>>
  BEGIN
    -- Readonly is an immutable ceiling for support impersonation. Neither a
    -- tenant role override nor a cross-tenant user override may add writes.
    IF prole = 'readonly' THEN
      res := p_action = 'view'
        AND EXISTS (
          select 1 from public.permission_defaults pd
          where pd.role = 'readonly' and pd.module = p_module and pd.action = 'view'
        );
      EXIT calc;
    END IF;

    IF prole <> 'owner' THEN
      res := NULL;
      select p_action = any(u.actions) into res
      from public.user_permission_overrides u
      where u.tenant_id = tid
        and u.user_id = uid
        and u.module = p_module
        and (u.expires_at is null or u.expires_at > now())
      limit 1;
      IF res IS NOT NULL THEN EXIT calc; END IF;
    END IF;

    res := NULL;
    select trp.allowed into res
    from public.tenant_role_permissions trp
    where trp.tenant_id = tid
      and trp.role = prole
      and trp.module = p_module
      and trp.action = p_action
    limit 1;
    IF res IS NOT NULL THEN EXIT calc; END IF;

    res := EXISTS (
      select 1 from public.permission_defaults pd
      where pd.role = prole and pd.module = p_module and pd.action = p_action
    );
  END calc;

  IF gname IS NOT NULL THEN
    PERFORM set_config(gname, k || CASE WHEN res THEN 't' ELSE 'f' END, true);
  END IF;
  RETURN res;
END;
$function$;
