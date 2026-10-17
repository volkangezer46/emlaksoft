-- MIGRATION 20261027010000_sample_flag_tenant_lock_guards.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261027010000_sample_flag_tenant_lock_guards.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261027010000_sample_flag_tenant_lock_guards.rollback.sql
-- BAGIMLILIK: 20261024020000_demo_mode_lock_purge_v2 (tenants.real_use_at / sample_seed_override_* sutunlari, profiles.is_sample).
--   guard_profile_identity_fields / guard_tenant_lifecycle_fields / current_active_tenant_id CANLI govdeleri (2026-10-27
--   pg_get_functiondef) temel alinip yalniz asagidaki eklemelerle yeniden tanimlanir.
--
-- NEDEN (denetim SEC-1, F4, SEC-4):
--   - authenticated, is_sample sutununu (profiles, customers, properties, deals, tasks ...) PostgREST ile degistirebiliyordu:
--     ofis kullanicisi kendini "ornek" isaretleyip koltuk sayimindan dusuyor (plan kapasitesi atlanir) ya da gercek kaydi
--     ornek isaretleyip "Gercek kullanima gec" temizligine sokabiliyordu (geri alinamaz silme).
--   - Ornek ekip profili (is_sample=true) ofis baglami (current_active_tenant_id) alabiliyordu; "giris yapamaz" kurali
--     hicbir yerde uygulanmiyordu.
--   - tenants.real_use_at / sample_seed_override_until / _by / sample_cleared_at / sample_pack settings:edit sahibi ofis
--     kullanicisinca yazilabiliyordu: super adminin verdigi yeniden yukleme izni kendine verilip sahte personel kimligi
--     yazilabiliyordu.
-- NE YAPAR:
--   1. public.sample_trusted_op(uuid): yalniz SECURITY DEFINER ornek veri fonksiyonunun (purge v3, 20261027010200) ayni
--      transaction icinde actigi isaret. Dogrudan PostgREST yazimi (current_user = anon/authenticated) bu isareti
--      ASLA kullanamaz; GUC'u yalniz SQL govdesi kurabilir.
--   2. guard_sample_flag_update(): is_sample sutunu olan HER public tabloya BEFORE UPDATE OF is_sample tetikleyicisi
--      (trg_00_sample_flag_guard; ad sirasi ile miras tetikleyicilerinden ONCE calisir). anon/authenticated JWT'siyle
--      bayrak degisimi reddedilir (42501); service_role, cron/betik ve guvenilir ornek veri fonksiyonu serbest.
--   3. guard_profile_identity_fields(): is_sample eklenir; purge v3'un ornek ekip profilini pasiflestirmesi (yalniz
--      is_sample=true profil, guvenilir isaretle) serbest birakilir (eskiden oturumlu sahip yolunda 42501 ile dusuyordu).
--   4. guard_tenant_lifecycle_fields(): real_use_at, sample_seed_override_until, sample_seed_override_by,
--      sample_cleared_at, sample_pack eklenir (anon/authenticated ve platform personeli degilse 42501). Guvenilir purge
--      isareti bu ofis icin acikken sample_seeded_at dahil ornek veri damgalari serbest.
--   5. current_active_tenant_id(): `and p.is_sample = false` (ornek ekip profili ofis baglami alamaz). On kontrol
--      (canli 2026-10-27): demo-ofis'in 8 giris profilinin hepsi is_sample=false; demo giris kartlari etkilenmez.
-- ETKI: siki (yeni reddetme kurallari). Tablo/sutun/satir degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null or pg_catalog.to_regclass('public.profiles') is null then
    raise exception '20261027010000: public.tenants / public.profiles yok.';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.tenants'::regclass and a.attname = 'real_use_at' and not a.attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attname = 'is_sample' and not a.attisdropped) then
    raise exception '20261027010000: once 20261024020000 uygulanmali (tenants.real_use_at, profiles.is_sample).';
  end if;
end $$;

-- ---------------------------------------------------------------- 1) guvenilir ornek veri isareti
create or replace function public.sample_trusted_op(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tenant_id is not null
     and current_user not in ('anon', 'authenticated')
     and coalesce(pg_catalog.current_setting('app.sample_trusted_tenant', true), '') = p_tenant_id::text;
$$;

comment on function public.sample_trusted_op(uuid) is
  'Yalniz SECURITY DEFINER ornek veri fonksiyonunun (purge) ayni transaction icinde kurdugu isaret; dogrudan anon/authenticated yazimi icin her zaman false.';

revoke all on function public.sample_trusted_op(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.sample_trusted_op(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.sample_trusted_op(uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.sample_trusted_op(uuid) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------- 2) is_sample yazma kapisi (tum tablolar)
create or replace function public.guard_sample_flag_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if new.is_sample is not distinct from old.is_sample then
    return new;
  end if;
  if coalesce(auth.role(), '') in ('anon', 'authenticated') or current_user in ('anon', 'authenticated') then
    begin
      v_tenant := nullif(pg_catalog.to_jsonb(old) ->> 'tenant_id', '')::uuid;
    exception when others then
      v_tenant := null;
    end;
    if not public.sample_trusted_op(v_tenant) then
      raise exception 'Ornek veri isareti (is_sample) yalniz guvenilir sunucu akisiyla degisir.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_sample_flag_update() is
  'SEC-1/F4 (20261027010000): is_sample bayragi anon/authenticated JWT ile degistirilemez; service_role ve guvenilir ornek veri fonksiyonu serbest.';

revoke all on function public.guard_sample_flag_update() from public;

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass::text as tbl
      from pg_catalog.pg_class c
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'is_sample' and not a.attisdropped
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and not c.relispartition
  loop
    execute pg_catalog.format('drop trigger if exists trg_00_sample_flag_guard on %s', r.tbl);
    execute pg_catalog.format(
      'create trigger trg_00_sample_flag_guard before update of is_sample on %s for each row '
      || 'when (old.is_sample is distinct from new.is_sample) execute function public.guard_sample_flag_update()',
      r.tbl
    );
  end loop;
end $$;

-- ---------------------------------------------------------------- 3) profil kimlik alanlari (+ is_sample)
create or replace function public.guard_profile_identity_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- purge v3: guvenilir isaretle yalniz ORNEK ekip profili pasiflestirilir (gercek kullanici asla).
  if old.is_sample is true
     and new.is_sample is true
     and new.is_active is distinct from old.is_active
     and public.sample_trusted_op(old.tenant_id)
     and new.tenant_id is not distinct from old.tenant_id
     and new.branch_id is not distinct from old.branch_id
     and new.role is not distinct from old.role
     and new.two_factor_sms is not distinct from old.two_factor_sms
     and new.two_factor_version is not distinct from old.two_factor_version then
    return new;
  end if;
  if auth.role() in ('anon', 'authenticated') and (
    new.tenant_id is distinct from old.tenant_id
    or new.branch_id is distinct from old.branch_id
    or new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.is_sample is distinct from old.is_sample
    or new.two_factor_sms is distinct from old.two_factor_sms
    or (
      new.two_factor_version is distinct from old.two_factor_version
      and new.phone is not distinct from old.phone
      and new.two_factor_sms is not distinct from old.two_factor_sms
    )
  ) then
    raise exception 'Identity fields require the trusted server workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- 4) ofis yasam dongusu + demo kilidi alanlari
create or replace function public.guard_tenant_lifecycle_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_trusted boolean;
begin
  if auth.role() in ('anon', 'authenticated') then
    v_trusted := public.sample_trusted_op(old.id);
    if (
      new.id is distinct from old.id
      or new.slug is distinct from old.slug
      or new.plan is distinct from old.plan
      or new.status is distinct from old.status
      or new.trial_ends_at is distinct from old.trial_ends_at
      or new.team_size is distinct from old.team_size
      or new.created_at is distinct from old.created_at
      or new.lead_capture_token is distinct from old.lead_capture_token
      or (new.sample_seeded_at is distinct from old.sample_seeded_at and not v_trusted)
    ) then
      raise exception 'Tenant lifecycle fields require the trusted server workflow.'
        using errcode = '42501';
    end if;
    -- SEC-4: demo kilidi / yeniden yukleme izni alanlari (ofis kullanicisi kendine izin veremez, kimlik uyduramaz).
    if not v_trusted
       and not public.is_platform_staff()
       and (
         new.real_use_at is distinct from old.real_use_at
         or new.sample_seed_override_until is distinct from old.sample_seed_override_until
         or new.sample_seed_override_by is distinct from old.sample_seed_override_by
         or new.sample_cleared_at is distinct from old.sample_cleared_at
         or new.sample_pack is distinct from old.sample_pack
       ) then
      raise exception 'Demo kilidi alanlari yalniz guvenilir sunucu akisiyla degisir.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- 5) ofis baglami: ornek ekip profili alamaz
create or replace function public.current_active_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    and p.is_sample = false
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
$$;
