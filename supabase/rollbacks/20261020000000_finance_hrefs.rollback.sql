-- ROLLBACK 20261020000000_finance_hrefs.sql
-- Href ureten nesneler onceki govdelerine (eski yollar) doner; finance_saved_views.tab 'tekrarlayan' -> 'duzenli' ve eski
-- CHECK geri gelir. Saklanmis bildirim/icgoru/saved_views baglantilari GERI CEVRILMEZ (eski yollar silinmis kodla zaten
-- acilmaz; geri donuste kod da eski surume doner ve yeni yollar 404 olur — bildirimler okunmus sayilabilir).
set local lock_timeout = '5s';

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
       rp.id,
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
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = c.tenant_id and fp.customer_id = r.renter_customer_id and fp.archived_at is null
   order by (fp.kind = 'kiraci') desc, fp.created_at, fp.id
   limit 1
) rp on true
where c.status <> 'paid' and c.amount > coalesce(c.paid_amount, 0)
union all
select 'commission:' || m.id::text,
       'commission',
       m.id,
       m.tenant_id,
       'receivable',
       mp.id,
       coalesce(cu.full_name, '')::text,
       'Komisyon'::text,
       'komisyon'::text,
       (m.gross_amount + greatest(coalesce(m.vat_amount, 0), 0) - col.collected)::numeric,
       'TRY'::text,
       (m.created_at at time zone 'Europe/Istanbul')::date,
       ('/app/anlasmalar/' || m.deal_id::text)::text
from public.commissions m
left join public.deals d on d.id = m.deal_id
left join public.customers cu on cu.id = d.customer_id
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = m.tenant_id and fp.customer_id = d.customer_id and fp.archived_at is null
   order by (fp.kind = 'musteri') desc, fp.created_at, fp.id
   limit 1
) mp on true
cross join lateral (
  select coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0) as collected
    from public.cash_entries e
   where e.tenant_id = m.tenant_id and e.source_type = 'commission' and e.source_id = m.id and e.voided_at is null
) col
where m.status = 'calculated' and m.is_sample = false
  and m.gross_amount + greatest(coalesce(m.vat_amount, 0), 0) > col.collected
  and not exists (select 1 from public.finance_open_items x
                   where x.tenant_id = m.tenant_id and x.source_type = 'commission' and x.source_id = m.id
                     and x.posting_key is not null)
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
       op.id,
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
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = ag.tenant_id and pr.owner_customer_id is not null and fp.customer_id = pr.owner_customer_id
     and fp.archived_at is null
   order by (fp.kind = 'malik') desc, fp.created_at, fp.id
   limit 1
) op on true
cross join lateral (
  select coalesce((select sum(rp.amount - coalesce(rp.management_fee, 0)) from public.rent_payments rp
                    where rp.rental_id = ag.rental_id and rp.tenant_id = ag.tenant_id and rp.voided_at is null), 0)
       - coalesce((select sum(l.amount) from public.owner_charge_links l
                    where l.rental_id = ag.rental_id and l.tenant_id = ag.tenant_id), 0)
       - coalesce((select sum(op2.amount) from public.owner_payouts op2
                    where op2.rental_id = ag.rental_id and op2.tenant_id = ag.tenant_id and op2.voided_at is null), 0) as payable
) bal
where ag.managed and bal.payable > 0
union all
select 'building:' || bc.id::text,
       'building',
       bc.id,
       bc.tenant_id,
       'receivable',
       bp.id,
       coalesce(bcu.full_name, '')::text,
       ('Aidat ' || coalesce(b.name, '') || ' / ' || coalesce(u.unit_no, ''))::text,
       'aidat_tahsilat'::text,
       (bc.amount - bc.paid_amount)::numeric,
       'TRY'::text,
       bc.due_date,
       ('/app/aidat?sekme=binalar&bina=' || bc.building_id::text || '&bolum=tahsilat')::text
from public.building_charges bc
left join public.buildings b on b.id = bc.building_id and b.tenant_id = bc.tenant_id
left join public.building_units u on u.id = bc.unit_id and u.tenant_id = bc.tenant_id
left join public.customers bcu on bcu.id = bc.payer_customer_id
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = bc.tenant_id and bc.payer_customer_id is not null and fp.customer_id = bc.payer_customer_id
     and fp.archived_at is null
   order by (fp.kind = case when bc.payer_role = 'tenant' then 'kiraci' else 'malik' end) desc, fp.created_at, fp.id
   limit 1
) bp on true
where bc.voided_at is null and bc.status <> 'paid' and bc.amount > bc.paid_amount
  and not exists (select 1 from public.finance_open_items x
                   where x.tenant_id = bc.tenant_id and x.source_type = 'building_charge' and x.source_id = bc.id
                     and x.posting_key is not null)
union all
select 'due:' || du.id::text,
       'due',
       du.id,
       du.tenant_id,
       'payable',
       null::uuid,
       coalesce(dp.title, '')::text,
       du.title,
       'aidat'::text,
       du.amount::numeric,
       'TRY'::text,
       coalesce(du.due_date, du.period),
       '/app/aidat'::text
from public.property_dues du
left join public.properties dp on dp.id = du.property_id
where du.status = 'unpaid' and du.amount > 0
  and not exists (select 1 from public.finance_open_items x
                   where x.tenant_id = du.tenant_id and x.source_type = 'due' and x.source_id = du.id
                     and x.posting_key is not null)
union all
select 'payout:' || cp.id::text,
       'payout',
       cp.id,
       cp.tenant_id,
       'payable',
       ap.id,
       coalesce(pf.full_name, '')::text,
       'Danışman hakedişi'::text,
       'danisman_hakedis'::text,
       cp.amount::numeric,
       'TRY'::text,
       (coalesce(cp.approved_at, cp.created_at) at time zone 'Europe/Istanbul')::date,
       '/app/cuzdan?sekme=ofis'::text
from public.commission_payouts cp
left join public.profiles pf on pf.id = cp.profile_id
left join lateral (
  select fp.id from public.finance_parties fp
   where fp.tenant_id = cp.tenant_id and fp.user_id = cp.profile_id and fp.kind = 'danisman' and fp.archived_at is null
   order by fp.created_at, fp.id
   limit 1
) ap on true
where cp.status in ('pending', 'approved') and cp.amount > 0
  and (cp.profile_id = (select auth.uid()) or (select public.has_effective_permission('earnings_all', 'view')))
  and not exists (select 1 from public.finance_open_items x
                   where x.tenant_id = cp.tenant_id and x.posting_key is not null
                     and ((x.source_type = 'commission_split' and x.source_id = cp.split_id)
                          or (x.source_type = 'commission_payout' and x.source_id = cp.id)));

revoke all on public.finance_open_items_v from public, anon, authenticated;
grant select on public.finance_open_items_v to authenticated, service_role;

create or replace function public.finance_party_statement(p_party_id uuid, p_from date default null, p_to date default null)
returns table (d date, doc_type text, ref_id uuid, title text, debit numeric, credit numeric, running_balance numeric, href text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
begin
  if p_party_id is null or (p_from is not null and p_to is not null and p_from > p_to) then perform public.finance_v2_raise('invalid_input'); end if;
  if not exists (select 1 from public.finance_parties pt where pt.id = p_party_id and pt.tenant_id = v_tenant)
     or (not public.has_effective_permission('earnings_all', 'view') and public.finance_party_foreign_advisor(p_party_id)) then
    perform public.finance_v2_raise('not_found');
  end if;

  return query
  with base as (
    select o.issue_date as bd, 0 as bord, (case when o.direction = 'receivable' then 'alacak' else 'borc' end)::text as btype,
           o.id as bref, o.title as btitle,
           (case when o.direction = 'receivable' then o.amount else 0 end)::numeric as bdebit,
           (case when o.direction = 'payable' then o.amount else 0 end)::numeric as bcredit,
           ('/app/giderler?sekme=cari&kalem=' || o.id::text)::text as bhref
      from public.finance_open_items o
     where o.tenant_id = v_tenant and o.party_id = p_party_id and o.status <> 'cancelled'
       and (o.category is distinct from 'maas' or v_gm)
    union all
    select e.entry_date, 1,
           (case when linked.id is not null then (case when e.direction = 'in' then 'tahsilat' else 'odeme' end)
                 else (case when e.direction = 'in' then 'pesin_tahsilat' else 'pesin_odeme' end) end)::text,
           e.id, e.title,
           (case when linked.id is null or e.direction = 'out' then e.amount + coalesce(e.withholding_amount, 0) else 0 end)::numeric,
           (case when linked.id is null or e.direction = 'in' then e.amount + coalesce(e.withholding_amount, 0) else 0 end)::numeric,
           ('/app/giderler?sekme=hareketler&hareket=' || e.id::text)::text
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
      left join public.finance_open_items linked
        on linked.id = e.open_item_id and linked.tenant_id = e.tenant_id and linked.status <> 'cancelled' and linked.party_id = p_party_id
     where e.tenant_id = v_tenant and e.voided_at is null and e.kind in ('income', 'expense')
       and (e.party_id = p_party_id or linked.id is not null)
       and (e.category is distinct from 'maas' or v_gm)
  ),
  opening as (
    select coalesce(sum(b.bdebit - b.bcredit), 0)::numeric as s from base b where p_from is not null and b.bd < p_from
  ),
  rows_in as (
    select b.*, (select o.s from opening o) + sum(b.bdebit - b.bcredit)
             over (order by b.bd, b.bord, b.bref rows between unbounded preceding and current row) as brun
      from base b
     where p_from is null or b.bd >= p_from
  )
  select x.xd, x.xtype, x.xref, x.xtitle, x.xdebit, x.xcredit, x.xrun, x.xhref
    from (
      select p_from as xd, -1 as xord, 'devir'::text as xtype, null::uuid as xref, 'Devir'::text as xtitle,
             greatest(o.s, 0)::numeric as xdebit, greatest(-o.s, 0)::numeric as xcredit, o.s as xrun, null::text as xhref
        from opening o
       where p_from is not null
      union all
      select r.bd, r.bord, r.btype, r.bref, r.btitle, r.bdebit, r.bcredit, r.brun, r.bhref
        from rows_in r
       where p_to is null or r.bd <= p_to
    ) x
   order by x.xd, x.xord, x.xref;
end;
$$;

create or replace function public.recurring_notify(
  p_rule_id uuid, p_title text, p_body text, p_kind text, p_key text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.recurring_rules%rowtype;
begin
  select * into r from public.recurring_rules x where x.id = p_rule_id;
  if not found then return; end if;
  insert into public.notifications (tenant_id, user_id, title, body, href, kind, dedupe_key)
  select r.tenant_id, p.id, p_title, p_body,
         case when r.scope = 'user' then '/app/hesabim?sekme=kasam' else '/app/giderler?sekme=duzenli' end,
         p_kind, p_key || ':' || p.id::text
  from public.profiles p
  where p.tenant_id = r.tenant_id and coalesce(p.is_active, true)
    and (
      (r.scope = 'user' and p.id = r.owner_user_id)
      or (r.scope = 'office' and p.role = any (case when r.category = 'maas' then array['owner', 'gm'] else array['owner', 'gm', 'accounting'] end))
    )
  on conflict do nothing;
end;
$$;

create or replace function public.fulfill_billing_payment(
  p_provider text,
  p_conversation_id text,
  p_payment_id text default null,
  p_source text default 'webhook',
  p_target_type text default 'subscription',
  p_expected_tenant_id uuid default null,
  p_expected_plan text default null,
  p_expected_cycle text default null,
  p_expected_amount_try numeric default null,
  p_expected_currency text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_conversation_id text := btrim(coalesce(p_conversation_id, ''));
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_target_type text := lower(btrim(coalesce(p_target_type, '')));
  v_expected_currency text := upper(btrim(coalesce(p_expected_currency, '')));
  v_event_id uuid;
  v_completed_event_id uuid;
  v_existing_event public.billing_fulfillment_events%rowtype;
  v_match_count integer;
  v_now timestamptz := now();
  v_result jsonb;

  v_invoice_id uuid;
  v_tenant_id uuid;
  v_invoice_status text;
  v_amount_try numeric;
  v_invoice_currency text;
  v_invoice_meta jsonb;
  v_plan text;
  v_cycle text;
  v_period_end timestamptz;
  v_tax_try numeric;
  v_total_try numeric;
  v_monthly_amount numeric;
  v_subscription_id uuid;
  v_updated_invoice_id uuid;
  v_updated_tenant_id uuid;

  v_sub_plan text;
  v_old_lock_try numeric;
  v_old_lock_campaign text;
  v_meta_lock_try numeric;
  v_meta_lock_campaign text;
  v_lock_try numeric;
  v_lock_campaign text;
  v_subscription_amount numeric;

  -- seat-fulfillment:v1 (20261005000900) ek kullanici faturasi degiskenleri
  v_kind text;
  v_seat_from_num numeric;
  v_seat_to_num numeric;
  v_seat_total_num numeric;
  v_seat_charge_net numeric;
  v_seat_quoted_period numeric;
  v_seat_from integer;
  v_seat_to integer;
  v_seat_total integer;
  v_seat_sub_cycle text;
  v_seat_sub_status text;
  v_seat_sub_extra integer;
  v_seat_sub_period_end timestamptz;
  v_seat_invoice_sub_id uuid;
  v_seat_updated_sub_id uuid;
  -- credit-pack:v1 >>> (20260826000300) kontor paketi faturasi degiskenleri
  v_pack_units_num numeric;
  v_pack_units integer;
  v_pack_price_net numeric;
  v_pack_id text;
  v_pack_grant jsonb;
  -- credit-pack:v1 <<<
  -- plan-upgrade:v1 >>> (20261007001010) oransal paket yukseltme faturasi degiskenleri
  v_up_from_plan text;
  v_up_charge_net numeric;
  v_up_new_period numeric;
  v_up_period_full numeric;
  v_up_sub_plan text;
  v_up_sub_cycle text;
  v_up_sub_status text;
  v_up_sub_period_end timestamptz;
  v_up_sub_paused timestamptz;
  v_up_sub_lock_campaign text;
  v_up_invoice_sub_id uuid;
  v_up_updated_sub_id uuid;
  v_up_old_monthly numeric;
  v_up_new_monthly numeric;
  v_up_lock numeric;
  v_up_campaign text;
  -- plan-upgrade:v1 <<<

  v_link_token text;
  v_payment_link_id uuid;
  v_payment_link_tenant_id uuid;
  v_payment_link_commission_id uuid;
  v_payment_link_status text;
  v_payment_link_amount_try numeric;
  v_payment_link_expires_at timestamptz;
  v_updated_payment_link_id uuid;
  v_updated_commission_id uuid;
  v_notification_id uuid;
  v_commission_changed boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if v_provider not in ('iyzico', 'demo') then
    raise exception 'Unsupported payment provider.' using errcode = '22023';
  end if;

  if v_conversation_id = '' or char_length(v_conversation_id) > 512 then
    raise exception 'Invalid conversation identity.' using errcode = '22023';
  end if;

  if v_payment_id is not null and char_length(v_payment_id) > 512 then
    raise exception 'Invalid payment identity.' using errcode = '22023';
  end if;

  if v_source not in ('callback', 'webhook', 'demo')
    or (v_provider = 'demo' and v_source <> 'demo')
    or (v_provider = 'iyzico' and v_source = 'demo') then
    raise exception 'Invalid fulfillment source.' using errcode = '22023';
  end if;

  if v_target_type not in ('subscription', 'payment_link') then
    raise exception 'Invalid fulfillment target.' using errcode = '22023';
  end if;

  if p_expected_amount_try is null or p_expected_amount_try <= 0 then
    raise exception 'Expected payment amount is required.' using errcode = '22023';
  end if;

  if v_expected_currency <> 'TRY' then
    raise exception 'Expected payment currency must be TRY.' using errcode = '22023';
  end if;

  if (v_target_type = 'payment_link' and left(v_conversation_id, 6) <> 'plink-')
    or (v_target_type = 'subscription' and left(v_conversation_id, 6) = 'plink-') then
    raise exception 'Conversation and fulfillment target do not match.' using errcode = '22023';
  end if;

  -- The unique insert is the race winner. A downstream exception rolls the
  -- claim back together with every side effect, allowing a safe provider retry.
  begin
    insert into public.billing_fulfillment_events (
      provider,
      conversation_id,
      payment_id,
      source,
      target_type,
      status
    ) values (
      v_provider,
      v_conversation_id,
      v_payment_id,
      v_source,
      v_target_type,
      'processing'
    )
    returning id into v_event_id;
  exception when unique_violation then
    select count(*)
      into v_match_count
    from public.billing_fulfillment_events e
    where e.provider = v_provider
      and (
        e.conversation_id = v_conversation_id
        or (v_payment_id is not null and e.payment_id = v_payment_id)
      );

    if v_match_count <> 1 then
      raise exception 'Payment identity conflict.' using errcode = '23505';
    end if;

    select e.*
      into v_existing_event
    from public.billing_fulfillment_events e
    where e.provider = v_provider
      and (
        e.conversation_id = v_conversation_id
        or (v_payment_id is not null and e.payment_id = v_payment_id)
      )
    limit 1;

    if v_existing_event.conversation_id is distinct from v_conversation_id
      or v_existing_event.target_type is distinct from v_target_type
      or (
        v_payment_id is not null
        and v_existing_event.payment_id is not null
        and v_existing_event.payment_id is distinct from v_payment_id
      ) then
      raise exception 'Payment identity conflict.' using errcode = '23505';
    end if;

    if v_existing_event.status <> 'completed' then
      raise exception 'Payment fulfillment is not complete.' using errcode = '55000';
    end if;

    if p_expected_tenant_id is not null
      and v_existing_event.result ->> 'tenantId' is distinct from p_expected_tenant_id::text then
      raise exception 'Completed payment tenant does not match.' using errcode = '22023';
    end if;

    if p_expected_plan is not null
      and lower(btrim(v_existing_event.result ->> 'plan'))
        is distinct from lower(btrim(p_expected_plan)) then
      raise exception 'Completed payment plan does not match.' using errcode = '22023';
    end if;

    if p_expected_cycle is not null
      and lower(btrim(v_existing_event.result ->> 'cycle'))
        is distinct from lower(btrim(p_expected_cycle)) then
      raise exception 'Completed payment cycle does not match.' using errcode = '22023';
    end if;

    if nullif(v_existing_event.result ->> 'amountTry', '') is null
      or abs((v_existing_event.result ->> 'amountTry')::numeric - p_expected_amount_try) > 0.01 then
      raise exception 'Completed payment amount does not match.' using errcode = '22023';
    end if;

    if upper(coalesce(v_existing_event.result ->> 'currency', '')) <> v_expected_currency then
      raise exception 'Completed payment currency does not match.' using errcode = '22023';
    end if;

    if v_existing_event.payment_id is null and v_payment_id is not null then
      update public.billing_fulfillment_events
      set payment_id = v_payment_id
      where id = v_existing_event.id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Existing fulfillment claim could not be updated.' using errcode = '55000';
      end if;
    end if;

    return coalesce(v_existing_event.result, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'already', true);
  end;

  if v_target_type = 'subscription' then
    select
      i.id,
      i.tenant_id,
      i.status,
      i.amount_try,
      i.currency,
      i.meta
    into
      v_invoice_id,
      v_tenant_id,
      v_invoice_status,
      v_amount_try,
      v_invoice_currency,
      v_invoice_meta
    from public.invoices i
    where i.meta ->> 'conversationId' = v_conversation_id
    order by i.created_at desc, i.id desc
    limit 1
    for update;

    if not found then
      raise exception 'Billing invoice not found.' using errcode = 'P0002';
    end if;

    if v_invoice_status not in ('open', 'paid') then
      raise exception 'Invoice is not payable.' using errcode = '22023';
    end if;

    if upper(btrim(coalesce(v_invoice_currency, ''))) <> v_expected_currency then
      raise exception 'Invoice currency does not match.' using errcode = '22023';
    end if;

    v_plan := coalesce(nullif(btrim(v_invoice_meta ->> 'plan'), ''), 'office');
    v_cycle := coalesce(nullif(btrim(v_invoice_meta ->> 'cycle'), ''), 'monthly');

    if v_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise')
      or v_cycle not in ('monthly', 'yearly') then
      raise exception 'Invoice billing metadata is invalid.' using errcode = '22023';
    end if;

    if p_expected_tenant_id is not null and p_expected_tenant_id is distinct from v_tenant_id then
      raise exception 'Invoice tenant does not match.' using errcode = '22023';
    end if;

    if p_expected_plan is not null
      and lower(btrim(p_expected_plan)) is distinct from v_plan then
      raise exception 'Invoice plan does not match.' using errcode = '22023';
    end if;

    if p_expected_cycle is not null
      and lower(btrim(p_expected_cycle)) is distinct from v_cycle then
      raise exception 'Invoice billing cycle does not match.' using errcode = '22023';
    end if;

    -- seat-fulfillment:v1 (20261005000900) ------------------------------------------------------------
    -- Fatura turu: meta.kind YOKSA plan yenileme/aktivasyon (asagidaki mevcut akis, AYNEN).
    -- 'extra_seats' = ek kullanici satisi: plan yenilemesi SAYILMAZ (plan, amount_try, price_lock_*,
    -- current_period_* ve tenants DEGISMEZ; yalniz subscriptions.extra_seats artar ve fatura 'paid' olur).
    -- Bilinmeyen tur reddedilir: ileride eklenecek bir fatura turu yanlislikla tam plan yenilemesi gibi
    -- islenip donemi uzatmasin.
    v_kind := nullif(btrim(coalesce(v_invoice_meta ->> 'kind', '')), '');
    -- credit-pack:v1 >>> (20260826000300) -------------------------------------------------------------
    -- 'credit_pack' = EmlakFiyati kontor paketi satisi. Plan yenilemesi SAYILMAZ: subscriptions (plan, durum,
    -- donem, amount_try, price_lock_*, extra_seats) ve tenants DEGISMEZ; yalniz ef_credit_grant ile kontor
    -- eklenir ve fatura 'paid' olur. Meta sozlesmesi: {packId, units, priceNetTry} (src/lib/ef-credits/config.ts
    -- efPackSchema: units 1..100000; priceNetTry KDV haric net = fatura amount_try). TEK SEFER (uc katman):
    -- billing_fulfillment_events tekil claim'i + 'paid' fatura kontrolu + grant idempotency ('invoice:<id>').
    -- Bu blok asagidaki tur kontrolunden ONCE doner; bilinmeyen tur reddi (asagida) AYNEN korunur.
    if v_kind = 'credit_pack' then
      if v_amount_try is null or v_amount_try <= 0 then
        raise exception 'Credit pack invoice amount is required.' using errcode = '22023';
      end if;

      v_tax_try := round(v_amount_try * 0.20, 2);
      v_total_try := round(v_amount_try + v_tax_try, 2);

      if abs(v_total_try - p_expected_amount_try) > 0.01 then
        raise exception 'Invoice total does not match.' using errcode = '22023';
      end if;

      if jsonb_typeof(v_invoice_meta -> 'units') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'priceNetTry') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'packId') is distinct from 'string' then
        raise exception 'Credit pack invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_pack_units_num := (v_invoice_meta ->> 'units')::numeric;
      v_pack_price_net := (v_invoice_meta ->> 'priceNetTry')::numeric;
      v_pack_id := btrim(v_invoice_meta ->> 'packId');

      -- units tamsayi 1..100000; packId katalog bicimi; fatura net tutari meta priceNetTry ile ayni (kurus toleransi).
      if v_pack_units_num <> trunc(v_pack_units_num)
        or v_pack_units_num < 1 or v_pack_units_num > 100000
        or v_pack_id !~ '^[a-z0-9][a-z0-9-]{1,31}$'
        or abs(v_pack_price_net - v_amount_try) > 0.01 then
        raise exception 'Credit pack invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_pack_units := v_pack_units_num::integer;

      -- Olay tablosundan once 'paid' olmus satir: kontor IKINCI KEZ EKLENMEZ.
      if v_invoice_status = 'paid' then
        v_result := jsonb_build_object(
          'ok', true,
          'already', true,
          'targetType', 'subscription',
          'kind', 'credit_pack',
          'tenantId', v_tenant_id::text,
          'invoiceId', v_invoice_id::text,
          'plan', v_plan,
          'cycle', v_cycle,
          'amountTry', v_total_try,
          'currency', v_expected_currency,
          'packId', v_pack_id,
          'units', v_pack_units,
          'creditGranted', false
        );

        update public.billing_fulfillment_events
        set
          status = 'completed',
          tenant_id = v_tenant_id,
          invoice_id = v_invoice_id,
          result = v_result,
          completed_at = v_now
        where id = v_event_id
        returning id into v_completed_event_id;

        if v_completed_event_id is null then
          raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
        end if;

        return v_result;
      end if;

      v_pack_grant := public.ef_credit_grant(
        v_tenant_id,
        v_pack_units,
        'purchase',
        'invoice:' || v_invoice_id::text,
        jsonb_build_object(
          'invoiceId', v_invoice_id::text,
          'packId', v_pack_id,
          'conversationId', v_conversation_id,
          'priceNetTry', v_amount_try
        )
      );

      if coalesce((v_pack_grant ->> 'ok')::boolean, false) is not true then
        raise exception 'Credit pack could not be granted.' using errcode = '55000';
      end if;

      -- Fatura: anlik satis (donem = odeme ani). subscription_id ve meta plan/cycle YAZILMAZ.
      update public.invoices i
      set
        status = 'paid',
        amount_try = v_amount_try,
        tax_try = v_tax_try,
        total_try = v_total_try,
        period_start = v_now,
        period_end = v_now,
        due_at = coalesce(i.due_at, v_now),
        paid_at = coalesce(i.paid_at, v_now),
        iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
        meta = i.meta || jsonb_build_object(
          'conversationId', v_conversation_id,
          'source', v_source,
          'provider', v_provider
        )
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Invoice could not be updated.' using errcode = '55000';
      end if;

      v_result := jsonb_build_object(
        'ok', true,
        'already', false,
        'targetType', 'subscription',
        'kind', 'credit_pack',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency,
        'packId', v_pack_id,
        'units', v_pack_units,
        'creditGranted', not coalesce((v_pack_grant ->> 'already')::boolean, false)
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;
    -- credit-pack:v1 <<<
    -- plan-upgrade:v1 >>> (20261007001010) ------------------------------------------------------------
    -- 'plan_upgrade' = donem ortasinda ust pakete oransal gecis. Abonelik DONEMI (current_period_*) ve billing_cycle
    -- DEGISMEZ; yalniz plan + kanonik aylik tutar (amount_try) + kilit + tenants.plan degisir, fatura 'paid' olur.
    -- Tutar YALNIZ faturadan (sunucu oransal hesapladi); katalog tavani: yeni planin tam donem tutarini asamaz.
    -- Bu blok asagidaki tur kontrolunden ONCE doner; bilinmeyen tur reddi (asagida) AYNEN korunur.
    if v_kind = 'plan_upgrade' then
      if v_amount_try is null or v_amount_try <= 0 then
        raise exception 'Plan upgrade invoice amount is required.' using errcode = '22023';
      end if;

      v_tax_try := round(v_amount_try * 0.20, 2);
      v_total_try := round(v_amount_try + v_tax_try, 2);

      if abs(v_total_try - p_expected_amount_try) > 0.01 then
        raise exception 'Invoice total does not match.' using errcode = '22023';
      end if;

      -- Meta sozlesmesi (src/lib/billing/plan-change.ts createPlanUpgradeInvoice): conversationId, plan (= hedef),
      -- cycle, source, kind, fromPlan, chargeNetTry, newPeriodTry.
      if jsonb_typeof(v_invoice_meta -> 'fromPlan') is distinct from 'string'
        or jsonb_typeof(v_invoice_meta -> 'chargeNetTry') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'newPeriodTry') is distinct from 'number' then
        raise exception 'Plan upgrade invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_up_from_plan := lower(btrim(v_invoice_meta ->> 'fromPlan'));
      v_up_charge_net := (v_invoice_meta ->> 'chargeNetTry')::numeric;
      v_up_new_period := (v_invoice_meta ->> 'newPeriodTry')::numeric;

      if v_up_from_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise')
        or v_up_from_plan = v_plan
        or v_up_new_period <= 0
        or v_up_charge_net <= 0
        or v_up_charge_net > v_up_new_period
        or abs(v_up_charge_net - v_amount_try) > 0.01 then
        raise exception 'Plan upgrade invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_up_period_full := public.plan_period_amount(v_plan, v_cycle);
      if v_up_period_full is null or v_up_charge_net > v_up_period_full + 0.01 then
        raise exception 'Plan upgrade amount exceeds the plan period price.' using errcode = '22023';
      end if;

      -- Olay tablosundan once 'paid' olmus eski satir: ikinci kez PLAN DEGISMEZ.
      if v_invoice_status = 'paid' then
        v_result := jsonb_build_object(
          'ok', true,
          'already', true,
          'targetType', 'subscription',
          'kind', 'plan_upgrade',
          'tenantId', v_tenant_id::text,
          'invoiceId', v_invoice_id::text,
          'plan', v_plan,
          'cycle', v_cycle,
          'amountTry', v_total_try,
          'currency', v_expected_currency,
          'fromPlan', v_up_from_plan
        );

        update public.billing_fulfillment_events
        set
          status = 'completed',
          tenant_id = v_tenant_id,
          invoice_id = v_invoice_id,
          result = v_result,
          completed_at = v_now
        where id = v_event_id
        returning id into v_completed_event_id;

        if v_completed_event_id is null then
          raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
        end if;

        return v_result;
      end if;

      select s.id, s.plan, s.billing_cycle, s.status, s.current_period_end, s.pause_started_at, s.price_lock_campaign
        into v_subscription_id, v_up_sub_plan, v_up_sub_cycle, v_up_sub_status, v_up_sub_period_end,
             v_up_sub_paused, v_up_sub_lock_campaign
      from public.subscriptions s
      where s.tenant_id = v_tenant_id
      for update;

      if not found then
        raise exception 'Subscription not found.' using errcode = 'P0002';
      end if;

      select i.subscription_id
        into v_up_invoice_sub_id
      from public.invoices i
      where i.id = v_invoice_id;

      if v_up_invoice_sub_id is not null and v_up_invoice_sub_id is distinct from v_subscription_id then
        raise exception 'Plan upgrade invoice subscription does not match.' using errcode = '22023';
      end if;

      -- Teklif belirli bir plan/donem/dongu icin hesaplandi; arada degistiyse tutar gecersizdir (tahsilat refund_required'a duser).
      if v_up_sub_plan is distinct from v_up_from_plan then
        raise exception 'Subscription plan changed since quote.' using errcode = '22023';
      end if;
      if v_up_sub_cycle is distinct from v_cycle then
        raise exception 'Plan upgrade cycle does not match subscription.' using errcode = '22023';
      end if;
      if v_up_sub_status is distinct from 'active' then
        raise exception 'Subscription is not active for plan upgrade.' using errcode = '22023';
      end if;
      if v_up_sub_paused is not null then
        raise exception 'Subscription is paused.' using errcode = '22023';
      end if;
      if v_up_sub_period_end is null or v_up_sub_period_end <= v_now then
        raise exception 'Subscription period is over.' using errcode = '22023';
      end if;

      v_up_old_monthly := public.plan_monthly_amount(v_up_from_plan);
      v_up_new_monthly := public.plan_monthly_amount(v_plan);
      if v_up_old_monthly is null or v_up_new_monthly is null or v_up_new_monthly <= v_up_old_monthly then
        raise exception 'Plan upgrade must move to a higher plan.' using errcode = '22023';
      end if;

      -- Fiyat kilidi: Founders uyesi yeni planin kampanya fiyatina yeniden kilitlenir; yoksa kilit kalkar (yenileme kuraliyla ayni).
      v_up_lock := null;
      v_up_campaign := null;
      if v_up_sub_lock_campaign is not null then
        v_up_lock := public.plan_campaign_lock_amount(v_plan);
        if v_up_lock is not null then
          v_up_campaign := v_up_sub_lock_campaign;
        end if;
      end if;

      update public.subscriptions s
      set
        plan = v_plan,
        amount_try = case when v_up_lock is not null then least(v_up_lock, v_up_new_monthly) else v_up_new_monthly end,
        price_lock_try = v_up_lock,
        price_lock_campaign = v_up_campaign,
        pending_plan = null,
        pending_plan_effective_at = null,
        pending_plan_requested_by = null,
        updated_at = v_now
      where s.id = v_subscription_id
        and s.tenant_id = v_tenant_id
        and s.plan = v_up_from_plan
      returning s.id into v_up_updated_sub_id;

      if v_up_updated_sub_id is null then
        raise exception 'Subscription plan could not be updated.' using errcode = '55000';
      end if;

      update public.tenants t
      set plan = v_plan, updated_at = v_now
      where t.id = v_tenant_id
      returning t.id into v_updated_tenant_id;

      if v_updated_tenant_id is null then
        raise exception 'Tenant could not be updated.' using errcode = '55000';
      end if;

      -- Fatura donemi: simdi -> mevcut donem sonu (oransal tahsilatin kapsadigi aralik). Abonelik donemi DEGISMEZ.
      update public.invoices i
      set
        subscription_id = v_subscription_id,
        status = 'paid',
        amount_try = v_amount_try,
        tax_try = v_tax_try,
        total_try = v_total_try,
        period_start = v_now,
        period_end = v_up_sub_period_end,
        due_at = coalesce(i.due_at, v_now),
        paid_at = coalesce(i.paid_at, v_now),
        iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
        meta = i.meta || jsonb_build_object(
          'conversationId', v_conversation_id,
          'plan', v_plan,
          'cycle', v_cycle,
          'source', v_source,
          'provider', v_provider
        )
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Invoice could not be updated.' using errcode = '55000';
      end if;

      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
      values (v_tenant_id, null, 'billing.plan_upgraded', 'subscription', v_subscription_id,
              jsonb_build_object('plan', v_up_from_plan),
              jsonb_build_object('plan', v_plan, 'invoice_id', v_invoice_id, 'charge_net_try', v_amount_try));

      v_result := jsonb_build_object(
        'ok', true,
        'already', false,
        'targetType', 'subscription',
        'kind', 'plan_upgrade',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency,
        'fromPlan', v_up_from_plan
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;
    -- plan-upgrade:v1 <<<
    if v_kind is not null and v_kind <> 'extra_seats' then
      raise exception 'Unsupported invoice kind.' using errcode = '22023';
    end if;

    if v_kind = 'extra_seats' then
      -- Tutar YALNIZ faturadan (sunucu oransal hesapladi); plan donem tutari yedegi KULLANILMAZ.
      if v_amount_try is null or v_amount_try <= 0 then
        raise exception 'Seat invoice amount is required.' using errcode = '22023';
      end if;

      v_tax_try := round(v_amount_try * 0.20, 2);
      v_total_try := round(v_amount_try + v_tax_try, 2);

      if abs(v_total_try - p_expected_amount_try) > 0.01 then
        raise exception 'Invoice total does not match.' using errcode = '22023';
      end if;

      -- Meta sozlesmesi (src/lib/billing/seat-purchase.ts createSeatInvoice): conversationId, plan, cycle,
      -- source, fromExtraSeats, toExtraSeats, targetTotalSeats, chargeNetTry, quotedPeriodTry.
      if jsonb_typeof(v_invoice_meta -> 'fromExtraSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'toExtraSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'targetTotalSeats') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'chargeNetTry') is distinct from 'number'
        or jsonb_typeof(v_invoice_meta -> 'quotedPeriodTry') is distinct from 'number' then
        raise exception 'Seat invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_seat_from_num := (v_invoice_meta ->> 'fromExtraSeats')::numeric;
      v_seat_to_num := (v_invoice_meta ->> 'toExtraSeats')::numeric;
      v_seat_total_num := (v_invoice_meta ->> 'targetTotalSeats')::numeric;
      v_seat_charge_net := (v_invoice_meta ->> 'chargeNetTry')::numeric;
      v_seat_quoted_period := (v_invoice_meta ->> 'quotedPeriodTry')::numeric;

      -- extra_seats CHECK (0..500) ile ayni sinir; yalniz ARTIS (to > from); toplam koltuk ek koltuktan buyuk
      -- (pakete en az 1 kullanici dahil); fatura net tutari meta chargeNetTry ile ayni (kurus toleransi).
      if v_seat_from_num <> trunc(v_seat_from_num)
        or v_seat_from_num < 0 or v_seat_from_num > 500
        or v_seat_to_num <> trunc(v_seat_to_num)
        or v_seat_to_num < 1 or v_seat_to_num > 500
        or v_seat_to_num <= v_seat_from_num
        or v_seat_total_num <> trunc(v_seat_total_num)
        or v_seat_total_num <= v_seat_to_num or v_seat_total_num > 100000
        or v_seat_quoted_period < 0
        or abs(v_seat_charge_net - v_amount_try) > 0.01 then
        raise exception 'Seat invoice metadata is invalid.' using errcode = '22023';
      end if;

      v_seat_from := v_seat_from_num::integer;
      v_seat_to := v_seat_to_num::integer;
      v_seat_total := v_seat_total_num::integer;

      -- Olay tablosundan once 'paid' olmus eski satir: ikinci kez ARTIS YAPILMAZ (plan akisindaki kural).
      if v_invoice_status = 'paid' then
        v_result := jsonb_build_object(
          'ok', true,
          'already', true,
          'targetType', 'subscription',
          'kind', 'extra_seats',
          'tenantId', v_tenant_id::text,
          'invoiceId', v_invoice_id::text,
          'plan', v_plan,
          'cycle', v_cycle,
          'amountTry', v_total_try,
          'currency', v_expected_currency,
          'fromExtraSeats', v_seat_from,
          'toExtraSeats', v_seat_to,
          'targetTotalSeats', v_seat_total
        );

        update public.billing_fulfillment_events
        set
          status = 'completed',
          tenant_id = v_tenant_id,
          invoice_id = v_invoice_id,
          result = v_result,
          completed_at = v_now
        where id = v_event_id
        returning id into v_completed_event_id;

        if v_completed_event_id is null then
          raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
        end if;

        return v_result;
      end if;

      select s.id, s.plan, s.billing_cycle, s.status, s.extra_seats, s.current_period_end
        into v_subscription_id, v_sub_plan, v_seat_sub_cycle, v_seat_sub_status, v_seat_sub_extra,
             v_seat_sub_period_end
      from public.subscriptions s
      where s.tenant_id = v_tenant_id
      for update;

      if not found then
        raise exception 'Subscription not found.' using errcode = 'P0002';
      end if;

      select i.subscription_id
        into v_seat_invoice_sub_id
      from public.invoices i
      where i.id = v_invoice_id;

      if v_seat_invoice_sub_id is not null and v_seat_invoice_sub_id is distinct from v_subscription_id then
        raise exception 'Seat invoice subscription does not match.' using errcode = '22023';
      end if;

      -- Teklif ayni plan/donem icin hesaplandi; arada plan ya da donem degistiyse tutar gecersizdir.
      if v_sub_plan is distinct from v_plan or v_seat_sub_cycle is distinct from v_cycle then
        raise exception 'Seat invoice plan does not match subscription.' using errcode = '22023';
      end if;

      -- startSeatPurchase yalniz 'active' abonelikte satar; tahsilat aninda da ayni kosul aranir.
      if v_seat_sub_status is distinct from 'active' then
        raise exception 'Subscription is not active for seat purchase.' using errcode = '22023';
      end if;

      -- Yalniz teklif anindaki koltuk sayisindan ARTIS: arada baska bir koltuk satisi/degisikligi islendiyse
      -- tahsil edilen oransal tutar artik dogru degildir; reddedilir (tahsilat kaydi refund_required'a duser).
      -- toExtraSeats mevcut extra_seats'tan kucuk/esitse de bu kosulla reddedilir (to > from zorunlu).
      if coalesce(v_seat_sub_extra, 0) <> v_seat_from then
        raise exception 'Extra seat count changed since quote.' using errcode = '22023';
      end if;

      update public.subscriptions s
      set
        extra_seats = v_seat_to,
        updated_at = v_now
      where s.id = v_subscription_id
        and s.tenant_id = v_tenant_id
        and s.extra_seats = v_seat_from
      returning s.id into v_seat_updated_sub_id;

      if v_seat_updated_sub_id is null then
        raise exception 'Extra seats could not be updated.' using errcode = '55000';
      end if;

      -- Fatura donemi: simdi -> mevcut donem sonu (oransal tahsilatin kapsadigi aralik). Abonelik donemi DEGISMEZ.
      update public.invoices i
      set
        subscription_id = v_subscription_id,
        status = 'paid',
        amount_try = v_amount_try,
        tax_try = v_tax_try,
        total_try = v_total_try,
        period_start = v_now,
        period_end = greatest(coalesce(v_seat_sub_period_end, v_now), v_now),
        due_at = coalesce(i.due_at, v_now),
        paid_at = coalesce(i.paid_at, v_now),
        iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
        meta = i.meta || jsonb_build_object(
          'conversationId', v_conversation_id,
          'plan', v_plan,
          'cycle', v_cycle,
          'source', v_source,
          'provider', v_provider
        )
      where i.id = v_invoice_id and i.tenant_id = v_tenant_id
      returning i.id into v_updated_invoice_id;

      if v_updated_invoice_id is null then
        raise exception 'Invoice could not be updated.' using errcode = '55000';
      end if;

      v_result := jsonb_build_object(
        'ok', true,
        'already', false,
        'targetType', 'subscription',
        'kind', 'extra_seats',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency,
        'fromExtraSeats', v_seat_from,
        'toExtraSeats', v_seat_to,
        'targetTotalSeats', v_seat_total
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;
    -- seat-fulfillment:v1 sonu: bundan sonrasi plan yenileme/aktivasyon (20261005000500 govdesi, AYNEN).

    -- Aylik liste fiyati plan tanimindan (platform katalogu; ayar yoksa onayli katalog).
    v_monthly_amount := public.plan_monthly_amount(v_plan);
    if v_monthly_amount is null or v_monthly_amount <= 0 then
      raise exception 'Plan amount could not be resolved.' using errcode = '22023';
    end if;

    -- Fatura tutari yoksa yedek: donem tutari (yillik = aylik * yillik odenen ay; 0.8 carpani yok).
    if v_amount_try is null or v_amount_try <= 0 then
      v_amount_try := public.plan_period_amount(v_plan, v_cycle);
    end if;

    v_tax_try := round(v_amount_try * 0.20, 2);
    v_total_try := round(v_amount_try + v_tax_try, 2);

    if abs(v_total_try - p_expected_amount_try) > 0.01 then
      raise exception 'Invoice total does not match.' using errcode = '22023';
    end if;

    -- Legacy paid rows may predate the event table. Claim them without extending
    -- the subscription period a second time.
    if v_invoice_status = 'paid' then
      v_result := jsonb_build_object(
        'ok', true,
        'already', true,
        'targetType', 'subscription',
        'tenantId', v_tenant_id::text,
        'invoiceId', v_invoice_id::text,
        'plan', v_plan,
        'cycle', v_cycle,
        'amountTry', v_total_try,
        'currency', v_expected_currency
      );

      update public.billing_fulfillment_events
      set
        status = 'completed',
        tenant_id = v_tenant_id,
        invoice_id = v_invoice_id,
        result = v_result,
        completed_at = v_now
      where id = v_event_id
      returning id into v_completed_event_id;

      if v_completed_event_id is null then
        raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
      end if;

      return v_result;
    end if;

    -- Fiyat kilidi (Founders). Kaynak sirasi: (1) sunucunun faturaya yazdigi teklif kilidi,
    -- (2) ayni planda mevcut kilit korunur, (3) plan degisiminde Founders uyesi yeni planin kampanya
    -- fiyatina yeniden kilitlenir (yoksa kilit kalkar).
    if v_invoice_meta ? 'priceLockTry' or v_invoice_meta ? 'priceLockCampaign' then
      if jsonb_typeof(v_invoice_meta -> 'priceLockTry') is distinct from 'number'
        or char_length(btrim(coalesce(v_invoice_meta ->> 'priceLockCampaign', ''))) not between 1 and 60 then
        raise exception 'Invoice price lock metadata is invalid.' using errcode = '22023';
      end if;
      v_meta_lock_try := (v_invoice_meta ->> 'priceLockTry')::numeric;
      v_meta_lock_campaign := btrim(v_invoice_meta ->> 'priceLockCampaign');
      if v_meta_lock_try <= 0 then
        raise exception 'Invoice price lock metadata is invalid.' using errcode = '22023';
      end if;
    end if;

    select s.plan, s.price_lock_try, s.price_lock_campaign
      into v_sub_plan, v_old_lock_try, v_old_lock_campaign
    from public.subscriptions s
    where s.tenant_id = v_tenant_id
    for update;

    if v_meta_lock_try is not null and v_meta_lock_try < v_monthly_amount then
      v_lock_try := v_meta_lock_try;
      v_lock_campaign := v_meta_lock_campaign;
    elsif v_old_lock_try is not null and v_sub_plan is not distinct from v_plan then
      v_lock_try := v_old_lock_try;
      v_lock_campaign := v_old_lock_campaign;
    elsif v_old_lock_campaign is not null and v_sub_plan is distinct from v_plan then
      v_lock_try := public.plan_campaign_lock_amount(v_plan);
      v_lock_campaign := case when v_lock_try is not null then v_old_lock_campaign end;
    end if;

    -- subscriptions.amount_try kanonik aylik (MRR) tutardir; kilit varsa kilitli fiyat.
    v_subscription_amount := case
      when v_lock_try is not null then least(v_lock_try, v_monthly_amount)
      else v_monthly_amount
    end;

    v_period_end := case
      when v_cycle = 'yearly' then v_now + interval '1 year'
      else v_now + interval '1 month'
    end;
    insert into public.subscriptions (
      tenant_id,
      plan,
      status,
      billing_cycle,
      amount_try,
      price_lock_try,
      price_lock_campaign,
      current_period_start,
      current_period_end,
      trial_ends_at,
      cancelled_at,
      iyzico_subscription_ref,
      updated_at
    ) values (
      v_tenant_id,
      v_plan,
      'active',
      v_cycle,
      v_subscription_amount,
      v_lock_try,
      v_lock_campaign,
      v_now,
      v_period_end,
      null,
      null,
      coalesce(v_payment_id, v_conversation_id),
      v_now
    )
    on conflict (tenant_id) do update
    set
      plan = excluded.plan,
      status = 'active',
      billing_cycle = excluded.billing_cycle,
      amount_try = excluded.amount_try,
      price_lock_try = excluded.price_lock_try,
      price_lock_campaign = excluded.price_lock_campaign,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      trial_ends_at = null,
      cancelled_at = null,
      iyzico_subscription_ref = excluded.iyzico_subscription_ref,
      updated_at = v_now
    returning id into v_subscription_id;

    if v_subscription_id is null then
      raise exception 'Subscription could not be updated.' using errcode = '55000';
    end if;

    update public.invoices i
    set
      subscription_id = v_subscription_id,
      status = 'paid',
      amount_try = v_amount_try,
      tax_try = v_tax_try,
      total_try = v_total_try,
      period_start = v_now,
      period_end = v_period_end,
      due_at = coalesce(i.due_at, v_now),
      paid_at = coalesce(i.paid_at, v_now),
      iyzico_payment_id = coalesce(i.iyzico_payment_id, v_payment_id),
      meta = i.meta || jsonb_build_object(
        'conversationId', v_conversation_id,
        'plan', v_plan,
        'cycle', v_cycle,
        'source', v_source,
        'provider', v_provider
      )
    where i.id = v_invoice_id and i.tenant_id = v_tenant_id
    returning i.id into v_updated_invoice_id;

    if v_updated_invoice_id is null then
      raise exception 'Invoice could not be updated.' using errcode = '55000';
    end if;

    update public.tenants t
    set plan = v_plan, status = 'active', updated_at = v_now
    where t.id = v_tenant_id
    returning t.id into v_updated_tenant_id;

    if v_updated_tenant_id is null then
      raise exception 'Tenant could not be updated.' using errcode = '55000';
    end if;

    v_result := jsonb_build_object(
      'ok', true,
      'already', false,
      'targetType', 'subscription',
      'tenantId', v_tenant_id::text,
      'invoiceId', v_invoice_id::text,
      'plan', v_plan,
      'cycle', v_cycle,
      'amountTry', v_total_try,
      'currency', v_expected_currency
    );

    update public.billing_fulfillment_events
    set
      status = 'completed',
      tenant_id = v_tenant_id,
      invoice_id = v_invoice_id,
      result = v_result,
      completed_at = v_now
    where id = v_event_id
    returning id into v_completed_event_id;

    if v_completed_event_id is null then
      raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
    end if;

    return v_result;
  end if;

  v_link_token := substring(v_conversation_id from 7);
  if nullif(v_link_token, '') is null then
    raise exception 'Payment link identity is invalid.' using errcode = '22023';
  end if;

  select
    pl.id,
    pl.tenant_id,
    pl.commission_id,
    pl.status,
    pl.amount_try,
    pl.expires_at
  into
    v_payment_link_id,
    v_payment_link_tenant_id,
    v_payment_link_commission_id,
    v_payment_link_status,
    v_payment_link_amount_try,
    v_payment_link_expires_at
  from public.payment_links pl
  where pl.token = v_link_token
  for update;

  if not found then
    raise exception 'Payment link not found.' using errcode = 'P0002';
  end if;

  if v_payment_link_status not in ('open', 'paid') then
    raise exception 'Payment link is not payable.' using errcode = '22023';
  end if;

  if v_payment_link_status = 'open'
    and v_payment_link_expires_at is not null
    and v_payment_link_expires_at <= v_now then
    raise exception 'Payment link has expired.' using errcode = '22023';
  end if;

  if p_expected_tenant_id is not null
    and p_expected_tenant_id is distinct from v_payment_link_tenant_id then
    raise exception 'Payment link tenant does not match.' using errcode = '22023';
  end if;

  if p_expected_plan is not null or p_expected_cycle is not null then
    raise exception 'Payment link does not accept subscription expectations.'
      using errcode = '22023';
  end if;

  if v_payment_link_amount_try is null
    or v_payment_link_amount_try <= 0
    or abs(v_payment_link_amount_try - p_expected_amount_try) > 0.01 then
    raise exception 'Payment link amount does not match.' using errcode = '22023';
  end if;

  if v_payment_link_status = 'paid' then
    v_result := jsonb_build_object(
      'ok', true,
      'already', true,
      'targetType', 'payment_link',
      'tenantId', v_payment_link_tenant_id::text,
      'paymentLinkId', v_payment_link_id::text,
      'amountTry', v_payment_link_amount_try,
      'currency', v_expected_currency
    );

    update public.billing_fulfillment_events
    set
      status = 'completed',
      tenant_id = v_payment_link_tenant_id,
      payment_link_id = v_payment_link_id,
      result = v_result,
      completed_at = v_now
    where id = v_event_id
    returning id into v_completed_event_id;

    if v_completed_event_id is null then
      raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
    end if;

    return v_result;
  end if;

  update public.payment_links pl
  set
    status = 'paid',
    paid_at = coalesce(pl.paid_at, v_now),
    meta = pl.meta || jsonb_build_object(
      'conversationId', v_conversation_id,
      'source', v_source,
      'provider', v_provider
    )
  where pl.id = v_payment_link_id
    and pl.tenant_id = v_payment_link_tenant_id
    and pl.status = 'open'
  returning pl.id into v_updated_payment_link_id;

  if v_updated_payment_link_id is null then
    raise exception 'Payment link could not be updated.' using errcode = '55000';
  end if;

  if v_payment_link_commission_id is not null then
    update public.commissions c
    set status = 'paid'
    where c.id = v_payment_link_commission_id
      and c.tenant_id = v_payment_link_tenant_id
      and c.status not in ('paid', 'collected')
    returning c.id into v_updated_commission_id;

    if v_updated_commission_id is not null then
      v_commission_changed := true;
    else
      perform 1
      from public.commissions c
      where c.id = v_payment_link_commission_id
        and c.tenant_id = v_payment_link_tenant_id
        and c.status in ('paid', 'collected');

      if not found then
        raise exception 'Payment link commission does not belong to tenant.'
          using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.notifications (
    tenant_id,
    title,
    body,
    href,
    kind,
    meta
  ) values (
    v_payment_link_tenant_id,
    'Ödeme linki tahsil edildi',
    case
      when v_source = 'demo' then 'Demo tahsilat tamamlandı.'
      else 'Kaparo / komisyon ödemesi alındı.'
    end,
    '/app/komisyon',
    'success',
    jsonb_build_object(
      'payment_link_id', v_payment_link_id,
      'fulfillment_event_id', v_event_id
    )
  )
  returning id into v_notification_id;

  if v_notification_id is null then
    raise exception 'Payment notification could not be created.' using errcode = '55000';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'already', false,
    'targetType', 'payment_link',
    'tenantId', v_payment_link_tenant_id::text,
    'paymentLinkId', v_payment_link_id::text,
    'commissionUpdated', v_commission_changed,
    'amountTry', v_payment_link_amount_try,
    'currency', v_expected_currency
  );

  update public.billing_fulfillment_events
  set
    status = 'completed',
    tenant_id = v_payment_link_tenant_id,
    payment_link_id = v_payment_link_id,
    result = v_result,
    completed_at = v_now
  where id = v_event_id
  returning id into v_completed_event_id;

  if v_completed_event_id is null then
    raise exception 'Fulfillment claim could not be completed.' using errcode = '55000';
  end if;

  return v_result;
end;
$$;

create or replace function public.notification_topic_from_href(p_href text)
returns text
language sql
immutable
set search_path = ''
as $$
  select t.topic
  from (values
    (1, '/app/randevular', 'randevu'),
    (2, '/app/gorevler', 'gorev'),
    (3, '/app/musteriler', 'musteri'),
    (4, '/app/talepler', 'musteri'),
    (5, '/app/gelen-kutusu', 'musteri'),
    (6, '/app/anketler', 'musteri'),
    (7, '/app/portfoyler', 'portfoy'),
    (8, '/app/ilan-kontrol', 'portfoy'),
    (9, '/app/ilan-havuzu', 'portfoy'),
    (10, '/app/portfoy-avi', 'portfoy'),
    (11, '/app/komisyon', 'finans'),
    (12, '/app/anlasmalar', 'finans'),
    (13, '/app/kiralama', 'finans'),
    (14, '/app/kira-artis', 'finans'),
    (15, '/app/aidat', 'finans'),
    (16, '/app/giderler', 'finans'),
    (17, '/app/cuzdan', 'finans'),
    (18, '/app/abonelik', 'finans'),
    (19, '/app/teklifler', 'finans')
  ) as t(ord, prefix, topic)
  where p_href is not null
    and pg_catalog.left(p_href, 1) = '/'
    and (
      pg_catalog.split_part(pg_catalog.split_part(p_href, '?', 1), '#', 1) = t.prefix
      or pg_catalog.starts_with(pg_catalog.split_part(pg_catalog.split_part(p_href, '?', 1), '#', 1), t.prefix || '/')
    )
  order by t.ord
  limit 1
$$;

alter table public.finance_saved_views drop constraint if exists finance_saved_views_tab_check;
update public.finance_saved_views set tab = 'duzenli' where tab = 'tekrarlayan';
alter table public.finance_saved_views
  add constraint finance_saved_views_tab_check
  check (tab in ('genel', 'hareketler', 'kasa-banka', 'cari', 'belgeler', 'duzenli', 'butce', 'vergi', 'raporlar', 'ayarlar'));
