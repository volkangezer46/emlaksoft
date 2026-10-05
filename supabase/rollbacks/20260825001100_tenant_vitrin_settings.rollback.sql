-- Rollback: 20260825001100_tenant_vitrin_settings (eski taslak adı 20260816060100; 2026-10-05 terfi etti).
-- Elle çalıştırılır; schema_migrations ledger satırına DOKUNMAZ. 20260825001200 rollback'inden SONRA.
-- Girilmiş vitrin tanıtım metinleri KALICI silinir.
alter table public.tenants drop constraint if exists tenants_vitrin_intro_len;
alter table public.tenants
  drop column if exists vitrin_intro,
  drop column if exists vitrin_enabled,
  drop column if exists vitrin_show_phone;
