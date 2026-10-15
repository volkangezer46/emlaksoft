-- MIGRATION 20261019070003_feature_request_changelog_link.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kolon yokken oneri durumu yine kaydedilir, yenilik baglantisi
--   yazilmaz (eylem kolonsuz yeniden dener) ve ofis panosunda "Yayinlandi" baglantisi cikmaz.
-- Geri alma: supabase/rollbacks/20261019070003_feature_request_changelog_link.rollback.sql (kolon duser).
-- BAGIMLILIK: 20261014008000 (product_feature_requests), 20261013004700 (changelog_entries).
--
-- NE (PA-10, Canny/Featurebase "dongu kapatma"): oneri "Yayinda" olunca hangi yenilik (changelog) girdisiyle
--   duyuruldugu. Oy veren ofislere giden bildirim ve ofis panosundaki "Yayinlandi" baglantisi bu girdiye gider.
--   Yenilik silinirse baglanti bosalir (on delete set null). Tablo RLS + FORCE ve politikasiz kalir (yalniz service_role).
set local lock_timeout = '5s';

alter table public.product_feature_requests
  add column if not exists changelog_entry_id uuid references public.changelog_entries(id) on delete set null;

create index if not exists idx_product_feature_requests_changelog
  on public.product_feature_requests (changelog_entry_id)
  where changelog_entry_id is not null;
