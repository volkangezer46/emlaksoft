-- TASLAK (UYGULANMADI, supabase/migrations'a TASINMADI): ek kullanici fiyat kilidi.
-- Tasarim: src/lib/billing/seat-pricing.ts (quoteSeats opts.lockedBaseMonthlyTry / opts.lockedTiers).
--
-- Bagimlilik: 20261005000800_billing_pause_proration_business_seats.sql (taslak) `subscriptions.extra_seats`
-- sutununu ekler; bu dosya YALNIZ kilit sutunlarini ekler. Uygulamadan once (1) restore edilebilir backup/PITR
-- dogrulanmali, (2) `npm run check:migrations -- --database` ve dry-run temiz olmali, (3) dosya yeni zaman damgasiyla
-- supabase/migrations'a tasinmali (forward-only). Uygulama kodu sema yokken zarifce calisir (kilit yok sayilir).
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
