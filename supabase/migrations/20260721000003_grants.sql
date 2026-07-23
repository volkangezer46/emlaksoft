-- API roles need explicit privileges on tables created via migrations
grant usage on schema public to anon, authenticated, service_role;

grant select on public.geo_provinces to anon, authenticated, service_role;
grant select on public.geo_districts to anon, authenticated, service_role;
grant select on public.geo_neighborhoods to anon, authenticated, service_role;

grant all on public.tenants to authenticated, service_role;
grant all on public.branches to authenticated, service_role;
grant all on public.profiles to authenticated, service_role;
grant all on public.customers to authenticated, service_role;
grant all on public.customer_demands to authenticated, service_role;
grant all on public.properties to authenticated, service_role;
grant all on public.portal_listings to authenticated, service_role;
grant all on public.listing_closures to authenticated, service_role;
grant all on public.deals to authenticated, service_role;
grant all on public.commissions to authenticated, service_role;
grant all on public.calls to authenticated, service_role;
grant all on public.audit_logs to authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public
  grant select on tables to anon, authenticated, service_role;
