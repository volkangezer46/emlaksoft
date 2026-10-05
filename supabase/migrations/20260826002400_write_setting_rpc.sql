-- MIGRATION 20260826002400_write_setting_rpc.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002400_write_setting_rpc.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002400_write_setting_rpc.rollback.sql
-- BAGIMLILIK: settings_history (002100), tenant_settings (002200), platform_settings.version (002300).
-- On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC: ATOMIK ayar yazimi. Deger + settings_history satiri AYNI islemde (SECURITY DEFINER, yalniz service_role).
-- Yetki/dogrulama (zod, sinirlar, gerekce) uygulama katmanindadir (src/lib/settings/write.ts); RPC veriyi yazar.
-- p_value null (veya JSON null) = "varsayilana don": platform'da deger NULL yapilir, tenant'ta satir silinir; gecmise islenir.
-- p_expected_version doluysa ve mevcut surumle uyusmuyorsa hicbir sey yazilmaz (conflict).
-- Gizli (p_is_secret) satirlarda gecmise deger YAZILMAZ; yalniz parmak izi.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.settings_history') is null then
    raise exception 'settings_history yok; once 20260826002100 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.tenant_settings') is null then
    raise exception 'tenant_settings yok; once 20260826002200 uygulanmali.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_settings' and column_name = 'version'
  ) then
    raise exception 'platform_settings.version yok; once 20260826002300 uygulanmali.';
  end if;
end $$;

create or replace function public.write_setting(
  p_scope            text,
  p_tenant_id        uuid,
  p_key              text,
  p_value            jsonb,
  p_is_secret        boolean,
  p_changed_by       uuid,
  p_actor_type       text,
  p_reason           text,
  p_fingerprint      text default null,
  p_summary          text default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_is_null boolean := p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null';
  v_old_json jsonb;
  v_old_ver integer;
  v_new_ver integer;
  v_text text;
begin
  if p_scope not in ('platform', 'tenant') then
    raise exception 'desteklenmeyen kapsam: %', p_scope using errcode = '22023';
  end if;
  if p_key is null or p_key = '' or char_length(p_key) > 120 then
    raise exception 'gecersiz anahtar' using errcode = '22023';
  end if;
  if p_scope = 'tenant' and p_tenant_id is null then
    raise exception 'tenant kapsami icin tenant_id zorunlu' using errcode = '22023';
  end if;
  if p_scope = 'platform' and p_tenant_id is not null then
    raise exception 'platform kapsaminda tenant_id olamaz' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.settings_write', '1', true);

  if p_scope = 'platform' then
    -- Eski deger metin olarak saklanir; gecmise jsonb string olarak islenir.
    select case when value is null then null else pg_catalog.to_jsonb(value) end, version
      into v_old_json, v_old_ver
      from public.platform_settings where key = p_key for update;
    v_old_ver := coalesce(v_old_ver, 0);

    if p_expected_version is not null and p_expected_version <> v_old_ver then
      return pg_catalog.jsonb_build_object('ok', false, 'conflict', true, 'version', v_old_ver);
    end if;
    v_new_ver := v_old_ver + 1;
    v_text := case when v_is_null then null else p_value #>> '{}' end;

    insert into public.platform_settings (key, value, updated_by, updated_at, version)
    values (p_key, v_text, p_changed_by, pg_catalog.now(), v_new_ver)
    on conflict (key) do update
      set value = excluded.value, updated_by = excluded.updated_by,
          updated_at = excluded.updated_at, version = excluded.version;
  else
    select value, version into v_old_json, v_old_ver
      from public.tenant_settings where tenant_id = p_tenant_id and key = p_key for update;
    v_old_ver := coalesce(v_old_ver, 0);

    if p_expected_version is not null and p_expected_version <> v_old_ver then
      return pg_catalog.jsonb_build_object('ok', false, 'conflict', true, 'version', v_old_ver);
    end if;
    v_new_ver := v_old_ver + 1;

    if v_is_null then
      delete from public.tenant_settings where tenant_id = p_tenant_id and key = p_key;
    else
      insert into public.tenant_settings (tenant_id, key, value, version, updated_by, updated_at)
      values (p_tenant_id, p_key, p_value, v_new_ver, p_changed_by, pg_catalog.now())
      on conflict (tenant_id, key) do update
        set value = excluded.value, version = excluded.version,
            updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    end if;
  end if;

  insert into public.settings_history
    (scope, tenant_id, key, version, old_value, new_value, is_secret, fingerprint, summary,
     changed_by, actor_type, reason)
  values
    (p_scope, p_tenant_id, p_key, v_new_ver,
     case when p_is_secret then null else v_old_json end,
     case when p_is_secret or v_is_null then null else p_value end,
     coalesce(p_is_secret, false), p_fingerprint, p_summary,
     p_changed_by, coalesce(p_actor_type, 'system'), left(p_reason, 500));

  return pg_catalog.jsonb_build_object('ok', true, 'version', v_new_ver);
end $$;

revoke all on function public.write_setting(text, uuid, text, jsonb, boolean, uuid, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.write_setting(text, uuid, text, jsonb, boolean, uuid, text, text, text, text, integer)
  to service_role;