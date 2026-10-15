-- Geri alma: 20261016040000_admin_staff_broadcast.sql
-- Tetikleyiciler, gonderici fonksiyonlar ve ozel konu politikalari kaldirilir; veri degismez. Admin paneli 60 sn
-- yoklama ve sayfa tazelemesine doner (kod kanal katilamazsa sessiz kalir).
set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['support_tickets', 'support_ticket_messages', 'invoices', 'subscriptions', 'alert_events'] loop
    if pg_catalog.to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists rt_staff_ins on public.%I', t);
      execute format('drop trigger if exists rt_staff_upd on public.%I', t);
      execute format('drop trigger if exists rt_staff_del on public.%I', t);
    end if;
  end loop;
  if pg_catalog.to_regclass('public.platform_notifications') is not null then
    execute 'drop trigger if exists rt_staff_notify on public.platform_notifications';
  end if;
  if pg_catalog.to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists rt_admin_staff_read on realtime.messages';
    execute 'drop policy if exists rt_staff_self_read on realtime.messages';
  end if;
end $$;

drop function if exists public.rt_emit_staff_change();
drop function if exists public.rt_emit_staff_notification();
drop function if exists public.rt_staff_payload(text, text, uuid, text[]);
drop function if exists public.rt_staff_send(jsonb, text);
drop function if exists public.rt_staff_can_listen();
