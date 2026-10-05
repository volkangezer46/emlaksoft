-- Rollback: 20260825000900_growth_click_counters (eski taslak adı 20260822000100; 2026-10-05 terfi etti).
-- Elle çalıştırılır; schema_migrations ledger satırına DOKUNMAZ. Tıklama sayaçları KALICI silinir.
drop function if exists public.growth_count_click(text, text);
drop table if exists public.growth_click_counters;
