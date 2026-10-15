-- 20261016050100 geri alma: komisyonun is_sample'ı anlaşmadan türeten tetikleyici kaldırılır.
-- VERİ: tek seferlik düzeltilen is_sample değerleri GERİ ALINMAZ (doğru değerler; eski hatalı duruma dönmek ciroyu
-- yeniden şişirir). Gerekirse PITR.

set local lock_timeout = '5s';

drop trigger if exists trg_commissions_inherit_sample on public.commissions;
drop function if exists public.commissions_inherit_sample();
