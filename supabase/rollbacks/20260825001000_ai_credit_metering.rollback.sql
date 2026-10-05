-- Rollback: 20260825001000_ai_credit_metering (eski taslak adi 20260820000300; 2026-10-05 terfi etti).
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz bu dosyanin ekledigi islevler/indeks. Defter tablosu 20260825000800 (buyume) ile paylasilir, DUSURULMEZ;
-- eklenen olcum sutunlari (feature/model/tokens_*) ve genisletilmis CHECK'ler (valuation/plan) KALIR.
drop function if exists public.ai_credit_metering_ready();
drop function if exists public.ai_credit_charge(uuid, text, numeric, text, text, integer, integer, uuid, text, timestamptz, timestamptz, numeric);
drop index if exists public.idx_credit_ledger_usage;
