-- Rollback: 20260825000400_subscription_seat_price_lock (eski taslak adi 20261005000400; 2026-10-05 terfi etti).
-- Elle, ters sirada calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: yazilmis koltuk fiyat kilitleri (seat_price_lock_base_try / seat_price_lock_tiers) KALICI silinir.
-- Kod sutun yokken kilidi yok sayar (liste fiyati).
alter table public.subscriptions
  drop column if exists seat_price_lock_tiers,
  drop column if exists seat_price_lock_base_try;

notify pgrst, 'reload schema';
