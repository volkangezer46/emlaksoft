-- Rollback: 20260817000230_coupons
drop function if exists public.redeem_coupon(text, uuid, uuid, text, numeric);
drop table if exists public.coupon_redemptions;
drop table if exists public.coupons;
