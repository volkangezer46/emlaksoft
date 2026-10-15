-- 20261019060000 geri alma: durtme defteri duser (gecmis silinir; kod tablo yokken durtme gondermez) ve platform
--   gorevlerinin oyun kitabi sutunlari kaldirilir (kural kaynakli gorevler SILINMEZ, elle gorev gibi kalir).
set local lock_timeout = '5s';

drop table if exists public.tenant_lifecycle_nudges;

drop index if exists public.platform_tasks_rule_idx;
drop index if exists public.platform_tasks_open_due_idx;
drop index if exists public.platform_tasks_dedupe_uidx;
alter table public.platform_tasks drop constraint if exists platform_tasks_priority_check;
alter table public.platform_tasks drop constraint if exists platform_tasks_dedupe_key_check;
alter table public.platform_tasks drop constraint if exists platform_tasks_source_rule_check;
alter table public.platform_tasks
  drop column if exists priority,
  drop column if exists dedupe_key,
  drop column if exists source_rule;
