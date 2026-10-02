-- webhook_events yalnız service_role tarafından kullanılır. RLS'nin policiesiz
-- varsayılan reddine güvenmek yerine istemci rollerini açıkça reddet; böylece
-- güvenlik denetimleri de bu tablonun bilinçli politikasını doğrulayabilir.

drop policy if exists webhook_events_deny_clients on public.webhook_events;
create policy webhook_events_deny_clients
  on public.webhook_events
  for all
  to anon, authenticated
  using (false)
  with check (false);
