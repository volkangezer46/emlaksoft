-- 20261018090200 geri alma: KVKK veri sahibi dokum tablosu duser (dokum anlik goruntuleri silinir). Talep kayitlari
--   (kvkk_requests) ve "kvkk.subject_export_generated" islem izi (audit_logs) kalir; kod tablo yokken dugmede
--   "bu ortamda etkin degil" der.
set local lock_timeout = '5s';

drop table if exists public.kvkk_subject_exports;
