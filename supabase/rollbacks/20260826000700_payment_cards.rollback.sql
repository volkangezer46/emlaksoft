-- Rollback: 20260826000700_payment_cards. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- DIKKAT: kayitli kart satirlari silinir; iyzico'daki saklanan kartlar KALIR (gerekirse iyzico panelinden/API'den silin).
drop index if exists public.uq_invoices_auto_renew_attempt;
drop function if exists public.remove_my_payment_card(uuid);
drop function if exists public.set_my_auto_renew_consent(boolean, uuid, text);
drop function if exists public.set_my_default_payment_card(uuid);
drop function if exists public.payment_card_provider_ref(uuid);
drop function if exists public.tenant_card_user_key();
drop function if exists public.set_default_payment_card(uuid, uuid);
drop table if exists public.tenant_payment_profiles;
drop table if exists public.payment_cards;
notify pgrst, 'reload schema';
