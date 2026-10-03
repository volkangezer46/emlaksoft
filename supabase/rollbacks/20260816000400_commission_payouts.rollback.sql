-- Rollback: 20260816000400_commission_payouts
-- DİKKAT: hakediş kayıtları (finansal) silinir; gerekiyorsa önce yedek alın:
--   create table public.commission_payouts_backup as select * from public.commission_payouts;
-- audit_logs satırları (action 'commission_payout.*') korunur.
drop table if exists public.commission_payouts;
drop function if exists public.audit_commission_payout();
drop function if exists public.guard_commission_payout_immutability();
