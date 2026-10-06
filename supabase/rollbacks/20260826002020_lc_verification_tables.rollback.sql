-- Rollback: 20260826002020_lc_verification_tables. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: kontrol durumlari, sonuc gunlugu, kuyruk ve cihaz kayitlari KAYBOLUR. Once 002040..002070 geri alinmali.
drop table if exists public.listing_verification_jobs;
drop table if exists public.listing_verifications;
drop table if exists public.portal_listing_health;
drop table if exists public.verification_clients;
