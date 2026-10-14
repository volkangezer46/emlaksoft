-- 20261015014000 geri alma: dusurulen 2 indeks pg_get_indexdef ciktisiyla (gölge zinciri ve canli ayni tanim) geri kurulur,
--   eklenen commission_splits indeksi kaldirilir. Yalniz indeks DDL; veri degismez.
set local lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON public.customers USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_demands_tenant_status ON public.customer_demands USING btree (tenant_id, status);
drop index if exists public.idx_commission_splits_commission_profile;
