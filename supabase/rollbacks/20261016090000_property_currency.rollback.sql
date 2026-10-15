-- Geri alma: 20261016090000_property_currency.sql
-- ONCE 20261016090100_publish_gate_portfolio_counts.rollback.sql uygulanir (portfolio_counts bu kolonu okur).
-- features.currency degerleri yerinde kalir (uygulama her kayitta oraya da yazdi); bosaltilan turetilmis price_health
-- degerleri geri getirilmez (kayit/duzenleme ve gece tazelemesi yeniden yazar).
-- KOD: properties.currency okuyan/yazan surum (SK9) yayindaysa ONCE onceki surume donulur; aksi halde portfoy
-- listesi/detayi kolon yok hatasi verir.
set local lock_timeout = '5s';
alter table public.properties drop constraint if exists properties_currency_check;
alter table public.properties drop column if exists currency;
