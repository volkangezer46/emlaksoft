-- GERİ ALMA: 20261013007000_tenant_portal_accounts.sql (EP1)
-- Kod tablo/RPC yokken öneriye (canlı ilan/gider/talep kanıtı) düşer; geri alma kod yayınını bozmaz.
-- DİKKAT: tablo düşürülünce sahiplerin portal üyelik beyanları kaybolur (önce gerekirse dışa alın).
-- Veri düzeltmesi (portal_listings.portal_name küçük harf) GERİ ALINMAZ: yalnız büyük/küçük harf ve boşluk değişti,
-- tekil indeksler ve kod zaten lower(btrim(portal_name)) ile çalışır; eski yazım bilgisi anlam taşımaz.
set local lock_timeout = '5s';

drop function if exists public.portal_membership_evidence(uuid);
drop function if exists public.portal_account_report_login(text, boolean);
drop table if exists public.tenant_portal_accounts;
