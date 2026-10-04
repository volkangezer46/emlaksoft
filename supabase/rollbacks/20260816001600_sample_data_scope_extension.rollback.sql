-- Rollback: 20260816001600_sample_data_scope_extension
-- Yalnız bayrak ve paket sütunları düşer; demo satırlar SİLİNMEZ (bayrak kaybolur, gerçek kayıt gibi görünür).
-- Önce demo veriyi temizleyin (Gerçek kullanıma başla) veya demo kodunu kapatın. Eski 086/096 sütunları kalır.
drop index if exists public.idx_properties_sample;
drop index if exists public.idx_customers_sample;
drop index if exists public.idx_profiles_sample;
drop index if exists public.idx_rentals_sample;
drop index if exists public.idx_contracts_sample;
drop index if exists public.idx_offers_sample;
drop index if exists public.idx_commissions_sample;
alter table public.tenants drop column if exists sample_cleared_at, drop column if exists sample_pack;
alter table public.profiles drop column if exists is_sample;
alter table public.notifications drop column if exists is_sample;
alter table public.expenses drop column if exists is_sample;
alter table public.calls drop column if exists is_sample;
alter table public.rentals drop column if exists is_sample;
alter table public.contracts drop column if exists is_sample;
alter table public.offers drop column if exists is_sample;
alter table public.commissions drop column if exists is_sample;
