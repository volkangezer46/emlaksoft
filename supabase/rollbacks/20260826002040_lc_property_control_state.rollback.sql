-- Rollback: 20260826002040_lc_property_control_state. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: turetilmis asama/skor/KPI bayraklari KAYBOLUR (kaynak veriden yeniden hesaplanabilir). Once 002070 geri alinmali.
drop function if exists public.lc_mark_state_stale(uuid, uuid);
drop table if exists public.property_control_state;
