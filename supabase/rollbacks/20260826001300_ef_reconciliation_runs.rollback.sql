-- Rollback: 20260826001300_ef_reconciliation_runs. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz mutabakat gecmisi kaybolur (defter/rezervler etkilenmez).
drop table if exists public.ef_reconciliation_runs;
