-- Taslak geri alma: yalniz bu dosyanin ekledigi islevler/indeks. Defter tablosu growth taslagiyla paylasilir, DUSURULMEZ.
drop function if exists public.ai_credit_metering_ready();
drop function if exists public.ai_credit_charge(uuid, text, numeric, text, text, integer, integer, uuid, text, timestamptz, timestamptz, numeric);
drop index if exists public.idx_credit_ledger_usage;
