-- Rollback: 20260826002970_contract_rental_link. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: sozlesme-kiralama baglantilari ve artis maddesi alanlari KAYBOLUR (sozlesme metinleri etkilenmez).
drop index if exists public.idx_contracts_rental;
alter table public.contracts drop constraint if exists contracts_rent_increase_pct_check;
alter table public.contracts drop constraint if exists contracts_rent_increase_basis_check;
alter table public.contracts drop constraint if exists contracts_rental_tenant_fkey;
alter table public.contracts drop column if exists rent_increase_fixed_pct;
alter table public.contracts drop column if exists rent_increase_basis;
alter table public.contracts drop column if exists rental_id;
