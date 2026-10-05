-- Rollback: 20260825000800_growth_referral_partner_attribution (eski taslak adı 20260819000100; 2026-10-05 terfi etti).
-- Elle çalıştırılır; schema_migrations ledger satırına DOKUNMAZ. Yalnız veri yoksa ya da yedekle çalıştır.
-- SIRA: önce 20260825001000 (AI kredi) ve 20260825000900 (tıklama sayacı) rollback'leri. account_credit_ledger
-- AI kredi ölçümüyle PAYLAŞILIR: bu dosya defteri (AI kullanım kayıtları dahil) KALICI siler.
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
