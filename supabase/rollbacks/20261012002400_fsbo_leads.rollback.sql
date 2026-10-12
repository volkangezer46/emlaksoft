-- 20261012002400 geri alma: sahibinden ilan (portfoy avi) tablolari duser. Veri kaybi: yalniz bu modulde kaydedilen
-- ilan/aday/etkinlik satirlari (musteri, portfoy, gorev kayitlari KALIR; tasks.fsbo_lead_id sutunu duser). Kod tablolar
-- yokken bos duruma duser.
drop index if exists public.idx_tasks_fsbo_lead;
alter table public.tasks drop column if exists fsbo_lead_id;
drop table if exists public.fsbo_do_not_call;
drop table if exists public.fsbo_lead_activities;
drop table if exists public.fsbo_lead_observations;
drop table if exists public.fsbo_leads;
notify pgrst, 'reload schema';
