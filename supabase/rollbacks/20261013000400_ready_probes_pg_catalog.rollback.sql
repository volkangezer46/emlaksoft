-- 20261013000400 geri alma: iki hazirlik yoklamasinin information_schema.columns kullanan eski govdeleri
--   (canlidan pg_get_functiondef ile birebir; gölge zinciriyle ayni). CREATE OR REPLACE ACL'i korur.
CREATE OR REPLACE FUNCTION public.plan_upgrade_ready()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_f10 text;
  v_v2 text;
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'subscriptions'
         and column_name in ('pause_started_at', 'pending_plan')) <> 2 then
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

CREATE OR REPLACE FUNCTION public.subscription_pause_ready()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  return (
    select count(*) = 6 from information_schema.columns
     where table_schema = 'public' and table_name = 'subscriptions'
       and column_name in ('pause_started_at', 'pause_ends_at', 'pause_last_started_at',
                           'pending_plan', 'pending_plan_effective_at', 'pending_plan_requested_by')
  ) and to_regprocedure('public.subscription_pause(integer)') is not null
    and to_regprocedure('public.subscription_resume()') is not null
    and to_regprocedure('public.subscription_resume_due()') is not null
    and to_regprocedure('public.subscription_apply_scheduled_plan_changes()') is not null;
exception when others then
  return false;
end;
$function$;
