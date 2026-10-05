-- Rollback: 20260826001200_ef_plan_credit_expiry
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ. Restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI.
-- 1. RPC kaldirilir (cron expire cagrisi hata verir ve yutulur; hak verme etkilenmez).
-- 2. Kaynak CHECK'i 'expire'siz haline YALNIZ source='expire' satiri yoksa doner (defter append-only: satir silinemez).
-- 3. ef.welcome_units / ef.welcome_since ayarlari BILEREK silinmez (admin degeri olabilir; zararsizdir).

drop function if exists public.ef_credit_expire_plan(uuid, integer, text);

do $$
begin
  if exists (select 1 from public.account_credit_ledger where source = 'expire') then
    raise notice '20260826001200 rollback: source=expire satiri var; source CHECK genisligi korundu (defter append-only).';
  else
    alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_source_check;
    alter table public.account_credit_ledger add constraint account_credit_ledger_source_check
      check (source in ('referral', 'partner', 'campaign', 'manual', 'usage', 'plan', 'purchase', 'bonus', 'refund'));
  end if;
end
$$;

notify pgrst, 'reload schema';
