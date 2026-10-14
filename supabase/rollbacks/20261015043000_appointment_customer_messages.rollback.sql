-- Rollback: 20261015043000_appointment_customer_messages. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: musteri teyit/hatirlatma SMS izleri KAYBOLUR (bir sonraki cron turu 24 saat icindeki randevular icin
-- musteriye ikinci hatirlatma gonderebilir; geri almadan once ofis ayari "Musteriye randevu SMS'i" kapatilmalidir).
alter table public.appointments drop column if exists customer_reminded_at;
alter table public.appointments drop column if exists customer_confirm_sent_at;
