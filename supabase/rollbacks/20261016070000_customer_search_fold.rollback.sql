-- Geri alma: 20261016070000_customer_search_fold.sql
-- Yalnız eklenen nesneler kaldırılır; müşteri verisi değişmez (üretilmiş sütunlar türetilmiş veridir).
-- DİKKAT: kod bu sütunları okuyorsa (searchTermFilter) önce kod geri alınmalıdır; aksi halde müşteri araması hata verir.
drop function if exists public.lookup_customer_by_phone(text, uuid[]);
drop index if exists public.idx_customers_tenant_phone_digits;
drop index if exists public.idx_customers_phone_digits_trgm;
drop index if exists public.idx_customers_search_fold_trgm;
alter table public.customers drop column if exists phone_digits;
alter table public.customers drop column if exists search_fold;
