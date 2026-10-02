-- GERİ ALMA: 20260813000300_expense_text_appointment_loose_definitions_system.sql
-- Migration değildir; gerekirse elle çalıştırılır.
-- (a) expenses.category enum'a GERİ DÖNÜLMEZ: kolon artık serbest metin olabilir; geri dönüş için önce
--     tüm değerlerin eski 6 enum değerinden biri olduğu doğrulanmalı (bu dosya bunu YAPMAZ). Bilinçli no-op.
-- (b) CHECK eski listeye döner; listede olmayan randevu tipi varsa ADD CONSTRAINT hata verir (önce veri düzeltilmeli).
-- (c) trigger/fonksiyon düşer, is_system kolonu düşer (işaret bilgisi kaybolur).
begin;

drop trigger if exists trg_definitions_guard_is_system on public.definitions;
drop function if exists public.definitions_guard_is_system();
alter table public.definitions drop column if exists is_system;

alter table public.appointments drop constraint if exists appointments_appointment_type_check;
alter table public.appointments
  add constraint appointments_appointment_type_check
  check (appointment_type in ('showing','office','valuation','contract','signing','other'));

commit;
