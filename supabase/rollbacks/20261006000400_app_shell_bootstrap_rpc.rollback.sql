-- ROLLBACK 20261006000400_app_shell_bootstrap_rpc.sql
-- Yalniz fonksiyonu dusurur; tablo/politika/veri degismemisti. Kod fonksiyon yokken eski (coklu sorgu) yola duser.

drop function if exists public.app_shell_bootstrap();
