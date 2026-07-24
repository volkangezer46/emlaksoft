-- Danışman başına müşteri sayısı — ekip sayfası 10.000 satır çekmek yerine
-- tek aggregate ile ~N danışman satırı alır.
create or replace function public.customer_counts_by_advisor(p_tenant_id uuid)
returns table(assigned_to uuid, cnt bigint)
language sql
stable
security definer
set search_path = public
as $$
  select assigned_to, count(*)::bigint as cnt
  from public.customers
  where tenant_id = p_tenant_id
    and deleted_at is null
    and assigned_to is not null
  group by assigned_to;
$$;

grant execute on function public.customer_counts_by_advisor(uuid) to authenticated, service_role;
