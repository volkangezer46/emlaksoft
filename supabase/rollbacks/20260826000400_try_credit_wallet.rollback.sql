-- Rollback: 20260826000400_try_credit_wallet
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ. Restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI.
-- Sira: 20260826000500 rollback -> BU DOSYA.
--
-- 1. Her zaman: try_credit_* RPC'leri, ic yardimcilar ve hareket gorunumu kaldirilir (kod try_credit_ready yoklamasinda
--    "etkin degil" der; kredi akisi kapanir). Defter append-only: try satirlari KALIR (denetim izi).
-- 2. Rezerv tablosu YALNIZ bos ise dusurulur (denetim izi). Dolu iken dusurmek icin: set local emlaksoft.rollback_force = 'on';
-- 3. account_credit_ledger_try_entry_check yalniz CHECK'tir; guvenle kaldirilir. `meta` sutunu/CHECK'i ef cuzdaniyla
--    PAYLASILIR: bu dosya onlara DOKUNMAZ (ef rollback'i yonetir).

drop function if exists public.try_credit_ready();
drop function if exists public.try_credit_my_overview();
drop function if exists public.try_credit_reverse(uuid, numeric, text, text, text, jsonb);
drop function if exists public.try_credit_release(uuid, uuid, text);
drop function if exists public.try_credit_commit(uuid, uuid, jsonb);
drop function if exists public.try_credit_reserve(uuid, uuid, numeric, text, uuid, numeric);
drop function if exists public.try_credit_grant(uuid, numeric, text, text, timestamptz, jsonb);
drop function if exists public.try_credit_balance(uuid);
drop function if exists public.try_credit_calc_balance(uuid);
drop function if exists public.try_credit_calc_state(uuid, timestamptz);
drop view if exists public.try_credit_movements;

-- Defter okuma politikasi 20260825001000'deki ilk haline doner (TL satirlari icin owner/gm kisiti kalkar).
drop policy if exists credit_ledger_own_select on public.account_credit_ledger;
create policy credit_ledger_own_select on public.account_credit_ledger for select
  using (tenant_id = public.current_tenant_id());

do $$
declare
  v_force boolean := coalesce(current_setting('emlaksoft.rollback_force', true), '') = 'on';
  v_rows boolean := false;
begin
  if pg_catalog.to_regclass('public.try_credit_reservations') is not null then
    execute 'select exists (select 1 from public.try_credit_reservations)' into v_rows;
    if v_rows and not v_force then
      raise notice 'try_credit_reservations satir iceriyor: tablo KORUNDU (dusurmek icin emlaksoft.rollback_force = on).';
    else
      execute 'drop table public.try_credit_reservations';
      execute 'drop function if exists public.try_credit_reservations_guard()';
    end if;
  else
    execute 'drop function if exists public.try_credit_reservations_guard()';
  end if;
  execute 'alter table public.account_credit_ledger drop constraint if exists account_credit_ledger_try_entry_check';
end
$$;

notify pgrst, 'reload schema';
