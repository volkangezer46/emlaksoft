-- GERİ ALMA: 20261013007100_portal_listings_name_normalize.sql (EP1)
-- Tetikleyici ve CHECK kalkar; küçük harfe çevrilmiş veri GERİ ALINMAZ (yalnız büyük/küçük harf ve boşluk; kod ve tekil
-- indeksler lower(btrim(portal_name)) ile çalışır). Kod bellekte portalIdFromName ile eşlediğinden geri alma onu bozmaz.
set local lock_timeout = '5s';

alter table public.portal_listings drop constraint if exists portal_listings_portal_name_normalized;
drop trigger if exists portal_listings_normalize_name on public.portal_listings;
drop function if exists public.portal_listings_normalize_name();
