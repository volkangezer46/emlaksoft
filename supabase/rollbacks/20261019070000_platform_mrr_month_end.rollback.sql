-- Geri alma: 20261019070000_platform_mrr_month_end.sql
-- Yalniz okuma fonksiyonu duser; veri degismez. Raporlar karti "okunamadi" der.
set local lock_timeout = '5s';
drop function if exists public.platform_mrr_month_end(date, date);
