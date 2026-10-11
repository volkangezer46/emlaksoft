-- Rollback: 20261011001200_bank_statement_import
-- Ekstre taslakları, dosya kayıtları, hatırlanan eşlemeler ve cash_entries.reconciled_at (mutabakat işareti) KAYBOLUR.
-- Hareketler (cash_entries) ve onlardan üretilmiş expenses kayıtları ETKİLENMEZ.

set local lock_timeout = '5s';

drop function if exists public.finance_reconciliation_status();
drop function if exists public.finance_statement_mapping_save(uuid, jsonb);
drop function if exists public.finance_statement_discard(uuid);
drop function if exists public.finance_statement_apply(uuid, jsonb);
drop function if exists public.finance_statement_stage(uuid, text, text, jsonb);

drop table if exists public.finance_statement_mappings;
drop table if exists public.finance_statement_lines;
drop table if exists public.finance_statement_imports;

drop index if exists public.idx_cash_entries_unreconciled;
alter table public.cash_entries drop column if exists reconciled_at;

notify pgrst, 'reload schema';
