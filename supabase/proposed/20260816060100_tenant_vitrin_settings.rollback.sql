-- Rollback: 20260816060100_tenant_vitrin_settings (UYGULANMADI taslak)
-- Girilmiş vitrin tanıtım metinleri KALICI silinir.
alter table public.tenants drop constraint if exists tenants_vitrin_intro_len;
alter table public.tenants
  drop column if exists vitrin_intro,
  drop column if exists vitrin_enabled,
  drop column if exists vitrin_show_phone;
