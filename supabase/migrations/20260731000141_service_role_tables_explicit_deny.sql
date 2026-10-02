-- These tables are intentionally service-role-only. Revoked grants already
-- prevent client access; explicit deny policies make that security boundary
-- visible to automated RLS audits and protect it if grants change later.

drop policy if exists billing_fulfillment_events_deny_clients
  on public.billing_fulfillment_events;
create policy billing_fulfillment_events_deny_clients
  on public.billing_fulfillment_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists registration_consents_deny_clients
  on public.registration_consents;
create policy registration_consents_deny_clients
  on public.registration_consents
  for all
  to anon, authenticated
  using (false)
  with check (false);

notify pgrst, 'reload schema';
