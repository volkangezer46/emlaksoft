-- Geri alma: 20261018050000_notifications_topic.sql
-- Bildirim konusu (topic) kolonu, tetikleyici ve yardimci fonksiyon kalkar; my_notification_counts 20261016050000
-- govdesine (konu kirilimi olmadan) doner. Kod kolon/kirilim yokken konu ciplerini gizler, tur ciplerine duser.
set local lock_timeout = '5s';

create or replace function public.my_notification_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select n.kind, n.created_at, (r.notification_id is null) as unread
    from public.notifications n
    left join public.notification_reads r
      on r.notification_id = n.id and r.user_id = (select auth.uid())
    where n.tenant_id = (select public.current_tenant_id())
      and (n.user_id is null or n.user_id = (select auth.uid()))
  )
  select jsonb_build_object(
    'unread', count(*) filter (where unread),
    'total', count(*),
    'week', count(*) filter (where created_at >= now() - interval '7 days'),
    'kinds', coalesce(
      (select jsonb_object_agg(k.kind, k.c) from (select kind, count(*) as c from mine group by kind) k),
      '{}'::jsonb
    )
  )
  from mine;
$$;

drop index if exists public.idx_notifications_tenant_user_topic;
drop trigger if exists trg_notifications_set_topic on public.notifications;
drop function if exists public.notifications_set_topic();
drop function if exists public.notification_topic_from_href(text);
alter table public.notifications drop constraint if exists notifications_topic_check;
alter table public.notifications drop column if exists topic;
