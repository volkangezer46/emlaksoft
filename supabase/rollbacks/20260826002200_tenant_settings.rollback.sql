-- Rollback: 20260826002200_tenant_settings. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: ofis ayar degerleri KAYBOLUR. Once 20260826002400 geri alinmalidir (bagimli).
drop table if exists public.tenant_settings;