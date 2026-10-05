-- MIGRATION 20260825000400 (2026-10-05 terfi; eski taslak adi proposed/20261005000400_subscription_seat_price_lock.sql).
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260825000400_subscription_seat_price_lock.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260825000400_subscription_seat_price_lock.rollback.sql (kilit degerleri silinir).
-- Ek kullanici fiyat kilidi. Tasarim: src/lib/billing/seat-pricing.ts (quoteSeats opts.lockedBaseMonthlyTry / opts.lockedTiers).
--
-- Bagimlilik: YOK (yalniz subscriptions'a iki nullable sutun ekler). `subscriptions.extra_seats` sutunu
-- 20260825000500_billing_pause_proration_business_seats.sql (eski taslak 20261005000800) ile gelir; bu dosya ona
-- dokunmaz, bu yuzden ondan ONCE uygulanabilir. Uygulamadan once `npm run check:migrations -- --database` ve dry-run
-- temiz olmali. Uygulama kodu sema yokken zarifce calisir (kilit yok sayilir). Kilit fulfill'de henuz YAZILMAZ
-- (20260825000600 bilinen boslugu).
--
-- Kural: mevcut abonenin kayitli fiyati degismez. Yeni liste fiyati yalniz yeni satislara ve yeni ek koltuklara uygulanir;
-- abone ilk ek koltugu aldiginda o anki kademeler `seat_price_lock_tiers` olarak dondurulur.

alter table public.subscriptions
  -- Kilitli aylik taban fiyat (kampanya/Founders kilidi `price_lock_try` ile ayni anlamda; null = liste).
  add column if not exists seat_price_lock_base_try numeric
    check (seat_price_lock_base_try is null or seat_price_lock_base_try > 0),
  -- Kilitli ek kullanici kademeleri: [{ "fromSeat":1, "toSeat":5, "monthlyTry":399 }, ...] (SeatTier[]).
  add column if not exists seat_price_lock_tiers jsonb
    check (seat_price_lock_tiers is null or jsonb_typeof(seat_price_lock_tiers) = 'array');

comment on column public.subscriptions.seat_price_lock_base_try is
  'Kilitli aylik taban fiyat (ek kullanici motoru icin). Null = guncel liste/kampanya fiyati.';
comment on column public.subscriptions.seat_price_lock_tiers is
  'Abonelik anindaki ek kullanici kademeleri (SeatTier[] JSON). Null = guncel liste kademeleri.';

notify pgrst, 'reload schema';
