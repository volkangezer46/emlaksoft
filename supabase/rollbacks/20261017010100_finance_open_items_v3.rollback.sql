-- Geri alma: 20261017010100_finance_open_items_v3.sql
-- finance_open_items_v 20261014011000 tanimina, finance_v2_source_visible 20261014001100 govdesine doner (kolonlar ayni).
-- 20261017010000 geri alinmadan ONCE calistirilir (v3 gorunumu posting_key kolonunu okur).
-- Etki: komisyon alacagi yine gross_amount - tahsilat; bina/aidat/hakedis kollari ve cari cozumu gorunumden kalkar.
set local lock_timeout = '5s';

create or replace function public.finance_v2_source_visible(p_source text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_source in ('rent', 'owner_payout') then public.has_effective_permission('rentals', 'view')
    when p_source = 'commission' then public.has_effective_permission('commissions', 'view')
    else true
  end;
$$;

create or replace view public.finance_open_items_v
with (security_invoker = true)
as
select 'manual:' || o.id::text as key,
       'manual'::text as source,
       o.id as source_id,
       o.tenant_id,
       o.direction,
       o.party_id,
       coalesce(p.name, '')::text as party_label,
       o.title,
       o.category,
       (o.amount - o.paid_amount)::numeric as amount_open,
       o.currency,
       o.due_date,
       ('/app/giderler?sekme=cari&kalem=' || o.id::text)::text as href
from public.finance_open_items o
left join public.finance_parties p on p.id = o.party_id
where o.status in ('open', 'partial') and o.amount > o.paid_amount
union all
select 'rent:' || c.id::text,
       'rent',
       c.id,
       c.tenant_id,
       'receivable',
       null::uuid,
       coalesce(cu.full_name, '')::text,
       ('Kira ' || pg_catalog.to_char(c.period, 'MM.YYYY'))::text,
       'kira_tahsilat'::text,
       (c.amount - coalesce(c.paid_amount, 0))::numeric,
       'TRY'::text,
       (c.period + (least(greatest(coalesce(r.due_day, 1), 1), 28) - 1))::date,
       ('/app/kiralama/' || r.id::text)::text
from public.rent_charges c
join public.rentals r on r.id = c.rental_id and r.tenant_id = c.tenant_id
left join public.customers cu on cu.id = r.renter_customer_id
where c.status <> 'paid' and c.amount > coalesce(c.paid_amount, 0)
union all
select 'commission:' || m.id::text,
       'commission',
       m.id,
       m.tenant_id,
       'receivable',
       null::uuid,
       coalesce(cu.full_name, '')::text,
       'Komisyon'::text,
       'komisyon'::text,
       (m.gross_amount
         - coalesce((select sum(e.amount) from public.cash_entries e
                      where e.tenant_id = m.tenant_id and e.source_type = 'commission' and e.source_id = m.id and e.voided_at is null), 0))::numeric,
       'TRY'::text,
       (m.created_at at time zone 'Europe/Istanbul')::date,
       ('/app/anlasmalar/' || m.deal_id::text)::text
from public.commissions m
left join public.deals d on d.id = m.deal_id
left join public.customers cu on cu.id = d.customer_id
where m.status = 'calculated' and m.is_sample = false
  and m.gross_amount
      > coalesce((select sum(e.amount) from public.cash_entries e
                   where e.tenant_id = m.tenant_id and e.source_type = 'commission' and e.source_id = m.id and e.voided_at is null), 0)
union all
select 'recurring:' || rr.id::text,
       'recurring',
       rr.id,
       rr.tenant_id,
       case when rr.direction = 'in' then 'receivable' else 'payable' end,
       rr.party_id,
       coalesce(p.name, '')::text,
       rr.title,
       rr.category,
       rr.amount::numeric,
       a.currency,
       rr.next_due,
       '/app/giderler?sekme=duzenli'::text
from public.recurring_rules rr
join public.finance_accounts a on a.id = rr.account_id and a.tenant_id = rr.tenant_id
left join public.finance_parties p on p.id = rr.party_id
where rr.active and rr.next_due is not null and rr.scope = 'office'
  and (rr.party_id is null or (select public.has_effective_permission('earnings_all', 'view')) or not public.finance_party_foreign_advisor(rr.party_id))
union all
select 'owner_payout:' || ag.rental_id::text,
       'owner_payout',
       ag.rental_id,
       ag.tenant_id,
       'payable',
       null::uuid,
       coalesce(pr.title, '')::text,
       'Mülk sahibi hakediş ödemesi'::text,
       'mulk_sahibi_odeme'::text,
       bal.payable::numeric,
       'TRY'::text,
       (pg_catalog.date_trunc('month', (pg_catalog.now() at time zone 'Europe/Istanbul'))::date + (ag.payout_day - 1))::date,
       ('/app/kiralama/' || ag.rental_id::text)::text
from public.rental_management_agreements ag
join public.rentals r on r.id = ag.rental_id and r.tenant_id = ag.tenant_id
left join public.properties pr on pr.id = r.property_id
cross join lateral (
  select coalesce((select sum(rp.amount - coalesce(rp.management_fee, 0)) from public.rent_payments rp
                    where rp.rental_id = ag.rental_id and rp.tenant_id = ag.tenant_id and rp.voided_at is null), 0)
       - coalesce((select sum(l.amount) from public.owner_charge_links l
                    where l.rental_id = ag.rental_id and l.tenant_id = ag.tenant_id), 0)
       - coalesce((select sum(op.amount) from public.owner_payouts op
                    where op.rental_id = ag.rental_id and op.tenant_id = ag.tenant_id and op.voided_at is null), 0) as payable
) bal
where ag.managed and bal.payable > 0;

revoke all on public.finance_open_items_v from public, anon, authenticated;
grant select on public.finance_open_items_v to authenticated, service_role;
comment on view public.finance_open_items_v is 'Açık alacak/borç birleşimi: manual, rent, commission, recurring, owner_payout. Her satır href taşır.';
notify pgrst, 'reload schema';
