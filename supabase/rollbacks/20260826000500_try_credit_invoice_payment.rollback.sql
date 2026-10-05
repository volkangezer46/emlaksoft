-- Rollback: 20260826000500_try_credit_invoice_payment
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ. Restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI.
-- Etki: kredi ile fatura odeme RPC'leri kalkar (fulfill_billing_payment/v2 govdelerine HIC dokunulmamisti); try_credit_ready()
-- 000400 surumune doner (kod yine hazir sayar: fatura odeme RPC'si yoksa kod 'kredi ile ode' secenegini gostermemelidir;
-- TS ayrica try_credit_invoice_hold yoklamasi yapar). ONCE bekleyen kredi rezervli faturalari bosaltin:
--   select count(*) from public.try_credit_reservations where state = 'reserved';
-- Harcanmis kredi (defter spend satirlari) ve committed rezervler KALIR (denetim izi).
-- Sira: bu dosya -> 20260826000400 rollback.

drop function if exists public.try_credit_refund_invoice(uuid, uuid, numeric, text, text);
drop function if exists public.try_credit_release_dead(integer);
drop function if exists public.try_credit_release_invoice(uuid, uuid, text);
drop function if exists public.try_credit_fulfill_invoice(text, uuid, text, text, text, text, numeric);
drop function if exists public.try_credit_invoice_hold(uuid, text);

create or replace function public.try_credit_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  if pg_catalog.to_regclass('public.try_credit_reservations') is null then
    return false;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = pg_catalog.to_regclass('public.account_credit_ledger')
      and c.conname = 'account_credit_ledger_try_entry_check'
  ) then
    return false;
  end if;
  if pg_catalog.to_regprocedure('public.try_credit_balance(uuid)') is null
    or pg_catalog.to_regprocedure('public.try_credit_grant(uuid, numeric, text, text, timestamptz, jsonb)') is null
    or pg_catalog.to_regprocedure('public.try_credit_reserve(uuid, uuid, numeric, text, uuid, numeric)') is null
    or pg_catalog.to_regprocedure('public.try_credit_commit(uuid, uuid, jsonb)') is null
    or pg_catalog.to_regprocedure('public.try_credit_release(uuid, uuid, text)') is null
    or pg_catalog.to_regprocedure('public.try_credit_reverse(uuid, numeric, text, text, text, jsonb)') is null then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.try_credit_ready() from public, anon, authenticated;
grant execute on function public.try_credit_ready() to service_role;

notify pgrst, 'reload schema';
