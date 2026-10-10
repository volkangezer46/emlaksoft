-- Rollback: 20261010000600_finance_accounts_cash_entries
-- Finans hesapları ve para hareket defteri düşer; hareket kayıtları KAYBOLUR (önce Rapor merkezi "Hesap ekstresi" ile dışa aktarın).
-- expenses, komisyon, kira ve aidat kayıtları ETKİLENMEZ (hareketle birlikte üretilen gider kayıtları yerinde kalır).

set local lock_timeout = '5s';

drop function if exists public.finance_cash_summary(date, date);
drop function if exists public.finance_account_balances();
drop function if exists public.finance_transfer(uuid, uuid, numeric, date, text);
drop function if exists public.finance_void_source_entries(text, uuid, text);
drop function if exists public.finance_void_entry(uuid, text);
drop function if exists public.finance_update_entry(uuid, numeric, date, text, text, text, text, text, text);
drop function if exists public.finance_record_entry(uuid, text, numeric, date, text, text, text, text, text, text, uuid, boolean, text, uuid);
drop function if exists public.finance_account_set_archived(uuid, boolean);
drop function if exists public.finance_account_update(uuid, text, text, numeric, date);
drop function if exists public.finance_account_create(text, text, text, text, text, numeric, date);

drop table if exists public.cash_entries;
drop table if exists public.finance_accounts;

drop function if exists public.finance_account_access(uuid, text);
drop function if exists public.finance_is_owner_gm();

notify pgrst, 'reload schema';
