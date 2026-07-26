-- Müşteri sıcaklık sinyalleri — /app/musteriler segment rozetleri + akıllı listeler.
--
-- customer_lead_signals'tan farkı:
--  * id LİSTESİ alır (p_customer_ids) — sayfadaki / segment havuzundaki müşteriler
--    için tek toplu sorgu, N+1 yok, tüm tenant taranmaz.
--  * Sıcaklık skorunun ek girdilerini döner: acil talep sayısı, son 30 gün portal
--    beğenisi, açık teklif ve süren anlaşma sayısı.
-- Skorlama DB'de DEĞİL, saf TS fonksiyonunda yapılır (src/lib/customer-heat.ts) —
-- formül test edilebilir kalır, burada yalnız ham sayımlar döner.
create or replace function public.customer_heat_signals(
  p_tenant_id uuid,
  p_customer_ids uuid[]
)
returns table(
  customer_id      uuid,
  last_contact     timestamptz,  -- en yeni görüşme notu / randevu / çağrı
  open_demands     int,
  urgent_demands   int,          -- açık taleplerden urgency high/urgent olanlar
  portal_likes_30d int,
  open_offers      int,          -- draft/submitted/countered
  open_deals       int           -- new/qualified/negotiation
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    greatest(m.last_at, a.last_at, ca.last_at),
    coalesce(d.cnt, 0)::int,
    coalesce(d.urgent, 0)::int,
    coalesce(pf.cnt, 0)::int,
    coalesce(o.cnt, 0)::int,
    coalesce(dl.cnt, 0)::int
  from public.customers c
  left join (
    select customer_id,
           count(*) as cnt,
           count(*) filter (where urgency in ('high', 'urgent')) as urgent
    from public.customer_demands
    where tenant_id = p_tenant_id
      and customer_id = any(p_customer_ids)
      and status in ('new', 'active', 'matched')
    group by customer_id
  ) d on d.customer_id = c.id
  left join (
    select customer_id, max(created_at) as last_at
    from public.communications
    where tenant_id = p_tenant_id and customer_id = any(p_customer_ids)
    group by customer_id
  ) m on m.customer_id = c.id
  left join (
    select customer_id, max(scheduled_at) as last_at
    from public.appointments
    where tenant_id = p_tenant_id and customer_id = any(p_customer_ids)
    group by customer_id
  ) a on a.customer_id = c.id
  left join (
    select customer_id, max(started_at) as last_at
    from public.calls
    where tenant_id = p_tenant_id and customer_id = any(p_customer_ids)
    group by customer_id
  ) ca on ca.customer_id = c.id
  left join (
    select customer_id, count(*) as cnt
    from public.portal_match_feedback
    where tenant_id = p_tenant_id
      and customer_id = any(p_customer_ids)
      and verdict = 'liked'
      and created_at >= now() - interval '30 days'
    group by customer_id
  ) pf on pf.customer_id = c.id
  left join (
    select customer_id, count(*) as cnt
    from public.offers
    where tenant_id = p_tenant_id
      and customer_id = any(p_customer_ids)
      and status in ('draft', 'submitted', 'countered')
    group by customer_id
  ) o on o.customer_id = c.id
  left join (
    select customer_id, count(*) as cnt
    from public.deals
    where tenant_id = p_tenant_id
      and customer_id = any(p_customer_ids)
      and stage in ('new', 'qualified', 'negotiation')
    group by customer_id
  ) dl on dl.customer_id = c.id
  where c.tenant_id = p_tenant_id
    and c.id = any(p_customer_ids)
    and c.deleted_at is null;
$$;

grant execute on function public.customer_heat_signals(uuid, uuid[]) to authenticated, service_role;
