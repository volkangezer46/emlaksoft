-- Rollback: 20260826002960_rent_reminders. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: hatirlatma ayarlari, hatirlatma kayitlari ve kiraci opt-out isaretleri KAYBOLUR.
drop table if exists public.rent_reminders;
drop table if exists public.rent_reminder_settings;
alter table public.customers drop column if exists rent_reminder_opt_out_at;
alter table public.customers drop column if exists rent_reminder_opt_out;
