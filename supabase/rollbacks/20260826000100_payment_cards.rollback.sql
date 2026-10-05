-- Rollback: 20260826000100_payment_cards. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- DIKKAT: kayitli kart satirlari silinir; iyzico'daki saklanan kartlar KALIR (gerekirse iyzico panelinden/API'den silin).
drop function if exists public.set_default_payment_card(uuid, uuid);
drop table if exists public.tenant_payment_profiles;
drop table if exists public.payment_cards;
notify pgrst, 'reload schema';
