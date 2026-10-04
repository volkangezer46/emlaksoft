-- K2: Business paketi + plan_entitlements yazma yetkisi (forward-only).
-- Panelden plan limitleri düzenlenince plan_entitlements (kota tetikleyicilerinin tek kaynağı)
-- service_role ile güncellenir; bu yüzden yazma yetkisi ve probe fonksiyonu eklenir.
-- NOT: fulfill_billing_payment ve update_tenant_plan_subscription plan listeleri bu dosyada
-- DEĞİŞMEZ; Business paketi o RPC'ler yeniden tanımlanana kadar satılmaz (panelde gizli kalır).

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.tenants'::regclass, 'public.subscriptions'::regclass, 'public.plan_entitlements'::regclass)
      and pg_get_constraintdef(oid) ilike '%advisor%enterprise%'
      and pg_get_constraintdef(oid) ilike '%plan%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.tenants
  add constraint tenants_plan_check check (plan in ('advisor', 'office', 'professional', 'business', 'enterprise'));
alter table public.subscriptions
  add constraint subscriptions_plan_check check (plan in ('advisor', 'office', 'professional', 'business', 'enterprise'));
alter table public.plan_entitlements
  add constraint plan_entitlements_plan_check check (plan in ('advisor', 'office', 'professional', 'business', 'enterprise'));

insert into public.plan_entitlements (plan, seat_limit, customer_limit, active_property_limit, branch_limit)
values ('business', 40, null, null, 20)
on conflict (plan) do nothing;

grant insert, update on public.plan_entitlements to service_role;

create or replace function public.plan_entitlements_writable()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select has_table_privilege('service_role', 'public.plan_entitlements', 'UPDATE');
$$;

revoke all privileges on function public.plan_entitlements_writable() from public, anon, authenticated;
grant execute on function public.plan_entitlements_writable() to service_role;

notify pgrst, 'reload schema';
