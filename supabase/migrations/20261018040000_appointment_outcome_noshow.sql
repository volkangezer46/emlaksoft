-- MIGRATION 20261018040000_appointment_outcome_noshow.sql
-- GA-14 (2026-10-18): randevu sonucu "gelmedi" (no-show).
-- Geri alma: supabase/rollbacks/20261018040000_appointment_outcome_noshow.rollback.sql ("gelmedi" satirlari outcome=null olur).
-- BAGIMLILIK: 20260729000126_appointment_outcome.sql (appointments.outcome + appointments_outcome_check).
--
-- NE: appointments_outcome_check kisiti 'gelmedi' degerini de kabul edecek sekilde yeniden kurulur.
-- NEDEN: Musteri gelmeyen randevu ayri olculur (gelmeme orani, takip gorevi, ?sonuc=gelmedi filtresi).
-- GUVENLIK: RLS/yetki degismez; yalniz CHECK kisiti genisler.
-- ETKI: ek (kabul edilen deger kumesi buyur; mevcut satirlar gecerli kalir). Idempotent.
--   Kod kisit eskiyken "gelmedi" yazarsa CHECK hatasi alir ve eylem Turkce hata doner; bu yuzden KOD YAYININDAN ONCE uygulanir.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.appointments') is null then
    raise exception 'appointments yok.';
  end if;
end $$;

alter table public.appointments drop constraint if exists appointments_outcome_check;
alter table public.appointments
  add constraint appointments_outcome_check
  check (outcome is null or outcome in ('olumlu', 'kararsiz', 'olumsuz', 'gelmedi'));

comment on column public.appointments.outcome is
  'Randevu sonucu: olumlu | kararsiz | olumsuz | gelmedi (danisman degerlendirmesi, null = degerlendirilmedi)';
