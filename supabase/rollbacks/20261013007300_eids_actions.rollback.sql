-- Geri alma: 20261013007300_eids_actions.sql
-- DİKKAT: yeni türdeki görevler (eids_publish / eids_takedown) ve 'urgent' öncelik eski CHECK'e uymaz. Geri almadan önce
-- bu satırlar dönüştürülür (tür -> 'other', öncelik -> 'high'); kontrol listesi tablosu düşer (kalem izi kaybolur).
begin;

drop trigger if exists trg_eids_takedown_mark_from_health on public.portal_listing_health;
drop trigger if exists trg_eids_takedown_guard_complete on public.tasks;
drop function if exists public.eids_takedown_mark_from_health();
drop function if exists public.eids_takedown_guard_complete();

drop table if exists public.eids_takedown_items;

update public.tasks set kind = 'other' where kind in ('eids_publish', 'eids_takedown');
update public.tasks set priority = 'high' where priority = 'urgent';

alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks
  add constraint tasks_kind_check
  check (kind = any (array['followup', 'call', 'visit', 'document', 'other']));
alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks
  add constraint tasks_priority_check
  check (priority = any (array['low', 'normal', 'high']));

drop index if exists public.idx_tasks_eids_takedown_open;
drop index if exists public.tasks_tenant_dedupe_key_uidx;
alter table public.tasks drop constraint if exists tasks_dedupe_key_len_check;
alter table public.tasks drop column if exists escalated_at;
alter table public.tasks drop column if exists dedupe_key;

update public.properties set authority_reminder_channel = null where authority_reminder_channel = 'email';
alter table public.properties drop constraint if exists properties_authority_reminder_channel_check;
alter table public.properties
  add constraint properties_authority_reminder_channel_check
  check (authority_reminder_channel is null or authority_reminder_channel in ('sms', 'whatsapp'));

commit;
