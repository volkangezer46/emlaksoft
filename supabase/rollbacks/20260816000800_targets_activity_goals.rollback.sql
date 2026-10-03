-- Rollback: 20260816000800_targets_activity_goals
-- Kod bu sütunları okuyorsa önce o kod kapatılmalı; girilmiş randevu/portföy/talep hedefleri silinir.
drop index if exists public.idx_targets_profile_period;
alter table public.targets
  drop column if exists target_appointments,
  drop column if exists target_listings,
  drop column if exists target_demands;
