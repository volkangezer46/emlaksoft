-- Geri alma: 20261015047020_batch_count_rpcs.sql
-- Yalniz salt-okunur sayim fonksiyonlari kaldirilir; veri degismez. Kod fonksiyonlar yokken eski ayri sorgulara duser.
drop function if exists public.kvkk_customer_related_counts(uuid[]);
drop function if exists public.ef_credit_balances(uuid[]);
drop function if exists public.offer_counts(uuid);
drop function if exists public.demand_counts(uuid[], uuid, text[], timestamptz);
drop function if exists public.target_activity_counts(uuid, jsonb);
notify pgrst, 'reload schema';
