-- 20261018060000 geri alma: kampanya rapor ve alici sayfalama fonksiyonlari duser.
-- Kod fonksiyon yokken alici listesini eski yoldan (ilk 500 satir, bellekte sayim) gosterir; veri degismez.
set local lock_timeout = '5s';

drop function if exists public.campaign_recipient_page(uuid, text, integer, integer, integer);
drop function if exists public.campaign_report(uuid, integer);
