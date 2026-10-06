-- Rollback: 20260826002300_platform_settings_guard. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Surum numaralari KAYBOLUR; ayar degerleri ve settings_history satirlari korunur.
drop trigger if exists platform_settings_bypass_guard on public.platform_settings;
drop function if exists public.platform_settings_bypass_guard();
alter table public.platform_settings drop column if exists schema_version;
alter table public.platform_settings drop column if exists version;