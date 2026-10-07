-- Rollback: 20261007001000_subscription_pause_and_plan_change
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ. Restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI.
-- SIRA: ONCE 20261007001010 rollback'i (fulfill gövdeleri bu sutunlara bakar), SONRA bu dosya.
-- Etki: duraklatma / planli dusurme RPC'leri ve sutunlari duser. Duraklatma sirasinda UZAMIS donem sonlari ve UYGULANMIS plan
-- degisiklikleri geri alinmaz. Su an duraklatilmis ofis varsa ONCE devam ettirin (donem sonu uzamasi korunur):
--   select tenant_id from public.subscriptions where pause_started_at is not null;
-- Kod RPC/sutun yokken ozellikleri gizler (getPlanSupport probe'u), bayraklar kapali kalir.

set local lock_timeout = '5s';

drop function if exists public.subscription_pause_ready();
drop function if exists public.subscription_apply_scheduled_plan_changes();
drop function if exists public.subscription_resume_due();
drop function if exists public.subscription_cancel_scheduled_downgrade();
drop function if exists public.subscription_schedule_downgrade(text);
drop function if exists public.subscription_resume();
drop function if exists public.subscription_pause(integer);
drop function if exists public.billing_setting_int(text, integer, integer, integer);
drop function if exists public.billing_setting_on(text);

alter table public.subscriptions drop constraint if exists subscriptions_pending_plan_check;
alter table public.subscriptions drop constraint if exists subscriptions_pause_pair_check;
alter table public.subscriptions
  drop column if exists pending_plan_requested_by,
  drop column if exists pending_plan_effective_at,
  drop column if exists pending_plan,
  drop column if exists pause_last_started_at,
  drop column if exists pause_ends_at,
  drop column if exists pause_started_at;

notify pgrst, 'reload schema';
