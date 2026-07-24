-- Müşteri lead sinyalleri — liste sayfasında sıcak/ılık/soğuk skorlama için
-- her müşterinin aktif talep / iletişim / randevu / çağrı sayısı + son etkileşim zamanı.
-- Tek aggregate ile (N sorgu yerine) döner.
create or replace function public.customer_lead_signals(p_tenant_id uuid)
returns table(
  customer_id     uuid,
  active_demands  int,
  comms           int,
  appts           int,
  calls           int,
  last_activity   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    coalesce(d.cnt, 0)::int,
    coalesce(m.cnt, 0)::int,
    coalesce(a.cnt, 0)::int,
    coalesce(ca.cnt, 0)::int,
    greatest(m.last_at, a.last_at, ca.last_at)
  from public.customers c
  left join (
    select customer_id, count(*) as cnt
    from public.customer_demands
    where tenant_id = p_tenant_id and status in ('new','active','matched')
    group by customer_id
  ) d on d.customer_id = c.id
  left join (
    select customer_id, count(*) as cnt, max(created_at) as last_at
    from public.communications where tenant_id = p_tenant_id group by customer_id
  ) m on m.customer_id = c.id
  left join (
    select customer_id, count(*) as cnt, max(scheduled_at) as last_at
    from public.appointments where tenant_id = p_tenant_id group by customer_id
  ) a on a.customer_id = c.id
  left join (
    select customer_id, count(*) as cnt, max(started_at) as last_at
    from public.calls where tenant_id = p_tenant_id group by customer_id
  ) ca on ca.customer_id = c.id
  where c.tenant_id = p_tenant_id and c.deleted_at is null;
$$;

grant execute on function public.customer_lead_signals(uuid) to authenticated, service_role;
