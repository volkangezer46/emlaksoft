-- 20261010000200 geri alma: yalniz bu migration'in 6 trigram indeksini dusurur (veri/tablo etkilenmez; arama seq scan'e doner).
drop index if exists public.idx_customers_full_name_trgm;
drop index if exists public.idx_customers_phone_trgm;
drop index if exists public.idx_customers_email_trgm;
drop index if exists public.idx_properties_title_trgm;
drop index if exists public.idx_properties_code_trgm;
drop index if exists public.idx_properties_address_trgm;
