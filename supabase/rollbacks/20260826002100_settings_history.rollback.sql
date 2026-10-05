-- Rollback: 20260826002100_settings_history. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: tum ayar degisiklik gecmisi KAYBOLUR. Once 20260826002400 ve 002300 geri alinmalidir (bagimli).
drop table if exists public.settings_history;