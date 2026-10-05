-- Rollback: 20260825001200_tenant_vitrin_sections_seo_optin (eski taslak adı 20260819010700; 2026-10-05 terfi etti).
-- Elle çalıştırılır; schema_migrations ledger satırına DOKUNMAZ.
-- Ofislerin verdiği arama görünürlüğü onayı ve bölüm tercihleri KALICI silinir.
alter table public.tenants
  drop column if exists vitrin_seo_optin,
  drop column if exists vitrin_show_lead_form,
  drop column if exists vitrin_show_valuation;
