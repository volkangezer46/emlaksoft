-- TASLAK rollback (proposed/20260816001200_growth_referral_partner_attribution.sql). Yalnız veri yoksa ya da yedekle çalıştır.
drop view if exists public.account_credit_balances;
drop table if exists public.success_stories;
drop table if exists public.growth_partner_payouts;
drop table if exists public.account_credit_ledger;
drop function if exists public.account_credit_ledger_immutable();
drop table if exists public.growth_reward_claims;
drop table if exists public.signup_attributions;
drop table if exists public.growth_referral_codes;
drop table if exists public.growth_partners;
drop table if exists public.growth_reward_rules;
