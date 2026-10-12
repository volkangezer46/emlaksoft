-- MIGRATION 20261012002510_automation_trigger_fsbo.sql
-- Sahibinden ilanlar (FSBO) otomasyon tetikleyicileri: new_fsbo_lead (olay) ve fsbo_no_contact_days (günlük tarama).
-- Yalnız enum değeri eklenir (ADD VALUE ve kullanımı ayrı dosyada olmalı; bu dosyada kullanılmaz). İdempotent.
-- Kod enum değeri yokken bu tetikleyicileri kaydetmez/seçtirmez hata verir; mevcut otomasyonlar etkilenmez.
-- FSBO'da yalnız görev oluştur / danışmana ata / bildirim eylemleri çalışır (SMS/WhatsApp/kampanya kodda KAPALI).

alter type public.automation_trigger add value if not exists 'new_fsbo_lead';
alter type public.automation_trigger add value if not exists 'fsbo_no_contact_days';
