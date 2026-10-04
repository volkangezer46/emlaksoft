-- Rollback: 20260819010700_tenant_vitrin_sections_seo_optin (UYGULANMADI taslak)
-- Ofislerin verdiği arama görünürlüğü onayı ve bölüm tercihleri KALICI silinir.
alter table public.tenants
  drop column if exists vitrin_seo_optin,
  drop column if exists vitrin_show_lead_form,
  drop column if exists vitrin_show_valuation;
