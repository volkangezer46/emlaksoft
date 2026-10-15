-- Geri alma: 20261016010300_platform_notification_feed.sql
-- Fonksiyon düşer; /api/admin/notifications rotası fonksiyon yokken eski iki sorguya kendiliğinden döner. Veri değişmez.
set local lock_timeout = '5s';

drop function if exists public.platform_notification_feed(integer);
