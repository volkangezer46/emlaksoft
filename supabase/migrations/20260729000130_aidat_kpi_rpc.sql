-- B-kalan — Aidat KPI tutar toplamları: 2000-satır havuzdan yaklaşık hesap yerine
-- DB'de tam SUM. Tenant-güvenli: current_tenant_id() JWT claim'iyle kısıtlanır
-- (security definer RLS'i baypas eder, filtre bu yüzden şart). Hem doğruluk hem
-- hız (2000 satır çekmek yerine tek agregat).
create or replace function public.aidat_kpi()
returns table (
  total         numeric,
  unpaid        numeric,
  overdue_count bigint,
  overdue_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount), 0)                                                              as total,
    coalesce(sum(amount) filter (where status <> 'paid'), 0)                              as unpaid,
    count(*)            filter (where status <> 'paid' and due_date <= current_date)       as overdue_count,
    coalesce(sum(amount) filter (where status <> 'paid' and due_date <= current_date), 0) as overdue_total
  from public.property_dues
  where tenant_id = public.current_tenant_id();
$$;

grant execute on function public.aidat_kpi() to authenticated;
