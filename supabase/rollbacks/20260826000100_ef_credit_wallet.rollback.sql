-- Rollback: 20260826000100_ef_credit_wallet
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ. Restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI.
-- Sira: 20260826000300 rollback -> 20260826000200 rollback -> BU DOSYA (ef_reports bu tabloya FK ile bagli).
--
-- 1. Her zaman: yedi ef_credit_* RPC'si kaldirilir (kod ef_credit_ready yoklamasinda "etkin degil" der, kontor akisi kapanir).
-- 2. Yalniz VERI YOKSA (defterde unit='ef' satiri YOK ve ef_credit_reservations bos): rezerv tablosu, guard tetikleyicisi,
--    'ef' CHECK genislemesi, ef satir CHECK'i, meta CHECK'i ve (tamamen bossa) meta sutunu geri alinir.
--    Defter append-only'dir (silme/guncelleme tetikleyiciyle yasak): 'ef' satiri varsa unit CHECK'i 'ef'siz yeniden
--    kurulamaz. Bu durumda yapisal kisim BILEREK atlanir (NOTICE) ve kontor bakiyesi korunur.
--    Rezerv kaydi varken tabloyu yine de dusurmek icin (denetim izi kaybolur): set local emlaksoft.rollback_force = 'on';
-- Kaynak CHECK'i ('purchase','bonus','refund') yalniz bu kaynaklarla satir yoksa eski listeye doner.

drop function if exists public.ef_credit_ready();
drop function if exists public.ef_credit_sweep(interval);
drop function if exists public.ef_credit_grant(uuid, integer, text, text, jsonb);
drop function if exists public.ef_credit_release(uuid, uuid, text);
drop function if exists public.ef_credit_commit(uuid, uuid, jsonb);
drop function if exists public.ef_credit_reserve(uuid, uuid, integer, text, text);
drop function if exists public.ef_credit_balance(uuid);

do $$
declare
  v_force boolean := coalesce(current_setting('emlaksoft.rollback_force', true), '') = 'on';
  v_ef_rows boolean;
  v_res_rows boolean := false;
begin
  if pg_catalog.to_regclass('public.ef_reports') is not null then
    raise exception 'once 20260826000200 rollback calistirilmali (ef_reports hala var).';
  end if;

  select exists (select 1 from public.account_credit_ledger where unit = 'ef') into v_ef_rows;
  if pg_catalog.to_regclass('public.ef_credit_reservations') is not null then
    execute 'select exists (select 1 from public.ef_credit_reservations)' into v_res_rows;
  end if;

  if v_res_rows and not v_force then
    raise notice 'ef_credit_reservations satir iceriyor: tablo KORUNDU (dusurmek icin emlaksoft.rollback_force = on).';
  elsif pg_catalog.to_regclass('public.ef_credit_reservations') is not null then
    execute 'drop table public.ef_credit_reservations';
  end if;
  execute 'drop function if exists public.ef_credit_reservations_guard()';

  if v_ef_rows then
    raise notice 'account_credit_ledger icinde unit=ef satiri var (append-only): CHECK genislemesi ve meta KORUNDU.';
    return;
  end if;

  execute 'alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_ef_entry_check';
  execute 'alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_meta_check';
  execute 'alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_unit_check';
  execute 'alter table public.account_credit_ledger add constraint account_credit_ledger_unit_check check (unit in (''try'', ''ai'', ''valuation''))';

  if not exists (select 1 from public.account_credit_ledger where source in ('purchase', 'bonus', 'refund')) then
    execute 'alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_source_check';
    execute 'alter table public.account_credit_ledger add constraint account_credit_ledger_source_check check (source in (''referral'', ''partner'', ''campaign'', ''manual'', ''usage'', ''plan''))';
  end if;

  if not exists (select 1 from public.account_credit_ledger where meta is not null) then
    execute 'alter table public.account_credit_ledger drop column if exists meta';
  end if;
end
$$;

notify pgrst, 'reload schema';
