-- Randevu sonucu — "Tamamlandı" tek yönlü bir damgaydı; randevunun NASIL
-- geçtiği hiçbir yerde tutulmuyordu. Danışman tamamlarken kısa bir sonuç
-- seçer (olumlu / kararsız / olumsuz) ve isterse not düşer.
--
-- NOT: Bu alan portal eşleştirme geri bildirimi (portal_match_feedback) ile
-- KARIŞTIRILMAMALIDIR — orada müşteri portföyü beğenir/beğenmez ve skor
-- öğrenme döngüsünü besler. Buradaki outcome danışmanın randevu değerlendirmesi;
-- eşleştirme skoruna girmez.

alter table public.appointments
  add column if not exists outcome text,
  add column if not exists outcome_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_outcome_check'
  ) then
    alter table public.appointments
      add constraint appointments_outcome_check
      check (outcome is null or outcome in ('olumlu', 'kararsiz', 'olumsuz'));
  end if;
end $$;

comment on column public.appointments.outcome is
  'Randevu sonucu: olumlu | kararsiz | olumsuz (danışman değerlendirmesi, null = değerlendirilmedi)';
comment on column public.appointments.outcome_note is
  'Randevu sonucuna dair kısa serbest not.';
