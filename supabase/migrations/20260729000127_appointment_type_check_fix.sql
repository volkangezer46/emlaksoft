-- A.1 — appointment_type CHECK'i definitions ile hizala.
-- definitions_more (043) 'signing' ve 'other' türlerini seed ediyordu ama
-- appointments CHECK'i yalnız ('showing','office','valuation','contract')
-- kabul ediyordu → ayarlardan bu türü seçen kullanıcı INSERT hatası alıyordu.
-- Union alınır: eski 'contract' korunur (mevcut satırlar bozulmasın), yeni
-- 'signing'/'other' eklenir.
alter table public.appointments
  drop constraint if exists appointments_appointment_type_check;

alter table public.appointments
  add constraint appointments_appointment_type_check
  check (appointment_type in ('showing','office','valuation','contract','signing','other'));
