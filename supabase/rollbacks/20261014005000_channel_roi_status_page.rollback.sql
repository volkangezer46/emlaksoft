-- 20261014005000 geri alma: pazarlama harcaması, durum sayfası olayları ve sürüm geçmişi tabloları kaldırılır.
-- UYARI: girilen harcama kayıtları, /durum olay/bakım geçmişi ve deploy sürüm satırları SİLİNİR.
-- Kod tablolar yokken Kanal ROI'de harcamayı yalnız Google Ads'ten okur, /durum yalnız ölçülen erişilebilirliği gösterir,
-- deploy.sh sürüm satırı yazmayı atlar.
set local lock_timeout = '5s';

drop table if exists public.status_incident_updates;
drop table if exists public.status_incidents;
drop table if exists public.release_history;
drop table if exists public.marketing_spend;
