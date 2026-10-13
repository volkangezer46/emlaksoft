-- MIGRATION 20261013000400_ready_probes_pg_catalog.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi).
-- Geri alma: supabase/rollbacks/20261013000400_ready_probes_pg_catalog.rollback.sql (eski govdeler birebir).
--
-- AMAC (DB-8, HIZ): plan_upgrade_ready() ve subscription_pause_ready() saglik/hazirlik yoklamalari her cagrida
--   information_schema.columns gorunumunu tariyordu (yetki filtresi + cok tablolu birlesim; tum kataloglari dolasir).
--   Ayni sayim pg_catalog.pg_attribute uzerinden tek tabloya (attrelid = to_regclass('public.subscriptions')) iner.
-- DAVRANIS AYNI: imza, donus tipi, STABLE SECURITY DEFINER, search_path = '', service_role kapisi, exception dali ve
--   diger kontroller birebir; govdeler canlidan pg_get_functiondef ile salt-okunur alindi (gölge zinciriyle ayni).
--   Tablo yoksa to_regclass NULL -> sayim 0 -> false (eskisi gibi). Silinmis sutunlar (attisdropped) sayilmaz;
--   information_schema da onlari gostermez. Sistem sutunlari (attnum <= 0) bu adlari tasimaz; yine de disarida.
-- ACL: CREATE OR REPLACE mevcut EXECUTE yetkilerini korur; yetki ifadesi yok.

create or replace function public.plan_upgrade_ready()
 returns boolean
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_f10 text;
  v_v2 text;
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  if (select count(*) from pg_catalog.pg_attribute a
       where a.attrelid = pg_catalog.to_regclass('public.subscriptions')
         and a.attnum > 0 and not a.attisdropped
         and a.attname in ('pause_started_at', 'pending_plan')) <> 2 then
    return false;
  end if;
  select p.prosrc into v_f10 from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)');
  select p.prosrc into v_v2 from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure('public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)');
  return v_f10 is not null and v_v2 is not null
    and position('plan-upgrade:v1' in v_f10) > 0
    and position('plan-upgrade:v1' in v_v2) > 0;
exception when others then
  return false;
end;
$function$;

create or replace function public.subscription_pause_ready()
 returns boolean
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  return (
    select count(*) = 6 from pg_catalog.pg_attribute a
     where a.attrelid = pg_catalog.to_regclass('public.subscriptions')
       and a.attnum > 0 and not a.attisdropped
       and a.attname in ('pause_started_at', 'pause_ends_at', 'pause_last_started_at',
                         'pending_plan', 'pending_plan_effective_at', 'pending_plan_requested_by')
  ) and to_regprocedure('public.subscription_pause(integer)') is not null
    and to_regprocedure('public.subscription_resume()') is not null
    and to_regprocedure('public.subscription_resume_due()') is not null
    and to_regprocedure('public.subscription_apply_scheduled_plan_changes()') is not null;
exception when others then
  return false;
end;
$function$;

-- DOGRULAMA (salt-okunur): service_role claim'iyle iki fonksiyon da uygulama oncesiyle ayni sonucu (canlida true) dondurur;
-- select p.proacl from pg_proc p where p.proname in ('plan_upgrade_ready', 'subscription_pause_ready'); -- degismemis olmali
