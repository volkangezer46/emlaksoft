-- Geri alma: 20261018040000_appointment_outcome_noshow.sql
-- "gelmedi" sonuclu randevularin sonucu SILINIR (outcome=null); kisit eski uc degere doner.
set local lock_timeout = '5s';
update public.appointments set outcome = null where outcome = 'gelmedi';
alter table public.appointments drop constraint if exists appointments_outcome_check;
alter table public.appointments
  add constraint appointments_outcome_check
  check (outcome is null or outcome in ('olumlu', 'kararsiz', 'olumsuz'));
