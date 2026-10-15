-- 20261018060100 geri alma: konusma fonksiyonu ve "tamamlandi" kolonlari duser.
-- VERI: resolved_at / resolved_by isaretleri kaybolur (yalniz gelen kutusu gorunum durumu; iletisim kayitlari yerinde kalir).
-- Kod fonksiyon yokken Konusmalar sekmesinde "etkin degil" bilgisini gosterir; akis ve cagri sekmeleri etkilenmez.
set local lock_timeout = '5s';

drop function if exists public.inbox_conversations(text, uuid, text, integer, integer);

alter table public.calls
  drop column if exists resolved_by,
  drop column if exists resolved_at;

alter table public.communications
  drop column if exists resolved_by,
  drop column if exists resolved_at;
