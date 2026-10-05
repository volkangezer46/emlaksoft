-- MIGRATION 20260826002300_platform_settings_guard.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002300_platform_settings_guard.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002300_platform_settings_guard.rollback.sql
-- BAGIMLILIK: public.platform_settings, public.settings_history (20260826002100). On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC: mevcut platform_settings GENISLETILIR (yeni tablo YOK): version + schema_version kolonlari ve
-- "bypass algilama" tetikleyicisi. write_setting RPC'si disindan (dogrudan upsert/delete) gelen her yazim
-- settings_history'ye DEGERSIZ bir 'dogrudan yazim' satiri birakir ve surumu artirir. Deger/yazim yolu degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.platform_settings') is null then
    raise exception 'platform_settings yok; once 20260722000025 uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.settings_history') is null then
    raise exception 'settings_history yok; once 20260826002100 uygulanmali.';
  end if;
end $$;

alter table public.platform_settings add column if not exists version integer not null default 1;
alter table public.platform_settings add column if not exists schema_version integer not null default 1;

create or replace function public.platform_settings_bypass_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rpc boolean := coalesce(pg_catalog.current_setting('app.settings_write', true), '') = '1';
  v_key text;
  v_ver integer;
  v_by uuid;
begin
  if v_rpc then
    -- RPC kendi gecmis satirini yazar; tetikleyici yalniz gecer.
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_key := old.key; v_ver := coalesce(old.version, 1) + 1; v_by := old.updated_by;
  else
    v_key := new.key;
    if tg_op = 'UPDATE' then
      new.version := coalesce(old.version, 1) + 1;
    else
      new.version := 1;
    end if;
    v_ver := new.version; v_by := new.updated_by;
  end if;

  insert into public.settings_history
    (scope, tenant_id, key, version, old_value, new_value, is_secret, changed_by, actor_type, reason, summary)
  values
    ('platform', null, v_key, v_ver, null, null,
     v_key ~ '(api_key|api_secret|api_token|password|secret)$' or v_key = 'openai_api_key',
     v_by, 'direct', 'dogrudan yazim (write_setting disi)', lower(tg_op));

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists platform_settings_bypass_guard on public.platform_settings;
create trigger platform_settings_bypass_guard
  before insert or update or delete on public.platform_settings
  for each row execute function public.platform_settings_bypass_guard();

revoke all on function public.platform_settings_bypass_guard() from public, anon, authenticated;