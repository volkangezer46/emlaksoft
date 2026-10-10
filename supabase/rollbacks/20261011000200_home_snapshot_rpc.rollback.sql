-- ROLLBACK 20261011000200_home_snapshot_rpc.sql
-- Yalniz home_snapshot fonksiyonunu dusurur; tablo/politika/veri degismemisti. Kod fonksiyon yokken mevcut sorgulara duser.

drop function if exists public.home_snapshot(text, integer);
