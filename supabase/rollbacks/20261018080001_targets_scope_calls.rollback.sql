-- 20261018080001 geri alma: takim/sube hedefi, cagri hedefi ve benzersizlik indeksleri kaldirilir; target_demands geri eklenir.
-- VERI: takim/sube hedefi satirlari SILINIR (eski semada ifade edilemez; ofis geneli sanilmasinlar). target_demands bos (0) doner.
-- Gerekirse PITR.

set local lock_timeout = '5s';

drop function if exists public.target_progress_counts(uuid, jsonb);

drop index if exists public.uq_targets_profile_period;
drop index if exists public.uq_targets_team_period;
drop index if exists public.uq_targets_branch_period;
drop index if exists public.uq_targets_office_period;
drop index if exists public.idx_targets_team;
drop index if exists public.idx_targets_branch;

delete from public.targets where team_id is not null or branch_id is not null;

alter table public.targets drop constraint if exists targets_single_scope_check;
alter table public.targets drop constraint if exists targets_target_calls_check;
alter table public.targets drop column if exists team_id;
alter table public.targets drop column if exists branch_id;
alter table public.targets drop column if exists target_calls;

alter table public.targets add column if not exists target_demands integer not null default 0;
alter table public.targets drop constraint if exists targets_target_demands_check;
alter table public.targets add constraint targets_target_demands_check check (target_demands >= 0);
