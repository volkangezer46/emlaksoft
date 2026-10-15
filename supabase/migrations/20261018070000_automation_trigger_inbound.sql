-- MIGRATION 20261018070000_automation_trigger_inbound.sql
-- COM-14: iletişim olayı tetikleyicileri. inbound_message = WhatsApp/SMS'ten gelen mesaj (yalnız GELEN; otomasyonun
-- gönderdiği mesaj tetikleyici olmaz), lead_form_submitted = talep/başvuru formu gönderildi (mükerrer müşteri dahil).
-- Yalnız enum değeri eklenir (ADD VALUE ve kullanımı ayrı dosyada olmalı; bu dosyada kullanılmaz). İdempotent.
-- Kod enum değeri yokken bu tetikleyicilerle kural kaydetmeye çalışırsa veritabanı hatası döner; mevcut kurallar etkilenmez.

alter type public.automation_trigger add value if not exists 'inbound_message';
alter type public.automation_trigger add value if not exists 'lead_form_submitted';
