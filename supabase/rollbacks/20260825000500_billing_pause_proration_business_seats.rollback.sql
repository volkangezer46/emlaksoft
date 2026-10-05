-- Rollback: 20260825000500_billing_pause_proration_business_seats (eski taslak adi 20261005000800, D bolumu cikarilmis hali).
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- SIRA: ONCE 20260825000600_seat_purchase_fulfillment.rollback.sql (koltuk tetikleyicileri effective_seat_limit'i
-- cagirmayi birakmali), SONRA bu dosya, en son 20260825000300_billing_plan_amount_integrity.rollback.sql.
-- UYARI (veri kaybi): satin alinmis ek koltuk sayilari (extra_seats) ve duraklatma kayitlari KALICI silinir.
-- Once salt-okunur kontrol (0 olmali; degilse once devam ettirin / ek koltuklari disa alin):
--   select count(*) filter (where paused_at is not null) as duraklatilmis,
--          count(*) filter (where extra_seats > 0)       as ek_koltuklu
--   from public.subscriptions;
drop function if exists public.quote_upgrade_proration(uuid, text, numeric);
drop function if exists public.resume_subscription(uuid, uuid);
drop function if exists public.pause_subscription(uuid, uuid, timestamptz);
drop function if exists public.effective_seat_limit(uuid);

alter table public.subscriptions
  drop column if exists extra_seats,
  drop column if exists pause_remaining,
  drop column if exists pause_resume_at,
  drop column if exists paused_at;

notify pgrst, 'reload schema';
