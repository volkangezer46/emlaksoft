-- Rollback: 20261014011000_finance_party_advisor_scope
-- finance_parties / finance_open_items SELECT politikaları, 10 fonksiyon ve finance_open_items_v 20261014001100 / 001000 tanımına döner
-- (danışman kapsamı yalnız arayüzde kalır; finance_aging yeniden 5 kova döner). Veri değişmez.
-- Sıra: önce politikalar ve gövdeler yardımcıdan arındırılır, en sonda finance_party_foreign_advisor düşer.

set local lock_timeout = '5s';

drop policy if exists finance_parties_select on public.finance_parties;
create policy finance_parties_select on public.finance_parties
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

drop policy if exists finance_open_items_select on public.finance_open_items;
create policy finance_open_items_select on public.finance_open_items
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'view'))
    and (category is distinct from 'maas' or (select public.finance_is_owner_gm()))
  );

create or replace function public.finance_v2_resolve_party(p_tenant uuid, p_party_id uuid, p_name text, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_kind text := coalesce(nullif(pg_catalog.btrim(coalesce(p_kind, '')), ''), 'diger');
begin
  if p_party_id is not null then
    select p.id into v_id from public.finance_parties p where p.id = p_party_id and p.tenant_id = p_tenant;
    if v_id is null then perform public.finance_v2_raise('party_not_found'); end if;
    return v_id;
  end if;
  if v_name = '' then return null; end if;
  if char_length(v_name) > 120 or v_kind not in ('musteri', 'malik', 'kiraci', 'tedarikci', 'danisman', 'diger') then
    perform public.finance_v2_raise('invalid_input');
  end if;
  select p.id into v_id from public.finance_parties p
   where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.archived_at is null
   order by (p.kind = v_kind) desc, p.created_at
   limit 1;
  if v_id is not null then return v_id; end if;
  if not public.has_effective_permission('expenses', 'create') then perform public.finance_v2_raise('forbidden'); end if;
  insert into public.finance_parties (tenant_id, kind, name, created_by)
  values (p_tenant, v_kind, v_name, auth.uid())
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select p.id into v_id from public.finance_parties p
     where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.kind = v_kind and p.archived_at is null;
  end if;
  return v_id;
end;
$$;

create or replace function public.finance_party_upsert(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tenant uuid;
  v_kind text := coalesce(nullif(pg_catalog.btrim(coalesce(p ->> 'kind', '')), ''), 'diger');
  v_name text := pg_catalog.btrim(coalesce(p ->> 'name', ''));
  v_tax text := nullif(pg_catalog.regexp_replace(coalesce(p ->> 'tax_id', ''), '[^0-9]', '', 'g'), '');
  v_iban text := nullif(pg_catalog.btrim(coalesce(p ->> 'iban_last4', '')), '');
  v_phone text := nullif(pg_catalog.btrim(coalesce(p ->> 'phone', '')), '');
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p ->> 'email', ''))), '');
  v_note text := nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), '');
  v_customer uuid;
  v_user uuid;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid;
    v_customer := nullif(p ->> 'customer_id', '')::uuid;
    v_user := nullif(p ->> 'user_id', '')::uuid;
  exception when invalid_text_representation then
    perform public.finance_v2_raise('invalid_input');
  end;
  v_tenant := public.finance_v2_ctx(case when v_id is null then 'create' else 'edit' end);

  if v_kind not in ('musteri', 'malik', 'kiraci', 'tedarikci', 'danisman', 'diger')
     or char_length(v_name) not between 1 and 120
     or (v_tax is not null and v_tax !~ '^[0-9]{10}$')
     or (v_iban is not null and v_iban !~ '^[0-9]{4}$')
     or (v_phone is not null and v_phone !~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$')
     or (v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
     or char_length(coalesce(v_note, '')) > 1000 then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_customer is not null and not exists (select 1 from public.customers c where c.id = v_customer and c.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_user is not null and not exists (select 1 from public.profiles pr where pr.id = v_user and pr.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  begin
    if v_id is null then
      insert into public.finance_parties (tenant_id, kind, name, tax_id, iban_last4, phone, email, customer_id, user_id, note, created_by)
      values (v_tenant, v_kind, v_name, v_tax, v_iban, v_phone, v_email, v_customer, v_user, v_note, auth.uid())
      returning id into v_id;
    else
      update public.finance_parties pt
         set kind = v_kind, name = v_name, tax_id = v_tax, iban_last4 = v_iban, phone = v_phone, email = v_email,
             customer_id = v_customer, user_id = v_user, note = v_note, updated_at = pg_catalog.now()
       where pt.id = v_id and pt.tenant_id = v_tenant;
      if not found then perform public.finance_v2_raise('not_found'); end if;
    end if;
  exception when unique_violation then
    perform public.finance_v2_raise('duplicate_name');
  end;
  return v_id;
end;
$$;

create or replace function public.finance_party_set_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
begin
  if p_id is null or p_archived is null then perform public.finance_v2_raise('invalid_input'); end if;
  begin
    update public.finance_parties pt
       set archived_at = case when p_archived then coalesce(pt.archived_at, pg_catalog.now()) end, updated_at = pg_catalog.now()
     where pt.id = p_id and pt.tenant_id = v_tenant;
    if not found then perform public.finance_v2_raise('not_found'); end if;
  exception when unique_violation then
    perform public.finance_v2_raise('duplicate_name');
  end;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, auth.uid(), case when p_archived then 'finance_party.archive' else 'finance_party.unarchive' end, 'finance_party', p_id, '{}'::jsonb);
end;
$$;

create or replace function public.finance_party_balances(p_kind text default null, p_q text default null)
returns table (party_id uuid, name text, kind text, receivable_open numeric, payable_open numeric, paid_in numeric, paid_out numeric,
               balance numeric, overdue_amount numeric, last_activity date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_q text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_q, ''))), '');
begin
  return query
  select pt.id, pt.name, pt.kind,
         coalesce(it.rec_open, 0), coalesce(it.pay_open, 0), coalesce(en.paid_in, 0), coalesce(en.paid_out, 0),
         coalesce(it.rec_open, 0) - coalesce(it.pay_open, 0), coalesce(it.overdue, 0),
         nullif(greatest(coalesce(en.last_d, date '2000-01-01'), coalesce(it.last_d, date '2000-01-01')), date '2000-01-01')
  from public.finance_parties pt
  left join lateral (
    select sum(o.amount - o.paid_amount) filter (where o.direction = 'receivable' and o.status in ('open', 'partial')) as rec_open,
           sum(o.amount - o.paid_amount) filter (where o.direction = 'payable' and o.status in ('open', 'partial')) as pay_open,
           sum(o.amount - o.paid_amount) filter (where o.status in ('open', 'partial') and o.due_date < v_today) as overdue,
           max(o.issue_date) as last_d
      from public.finance_open_items o
     where o.tenant_id = v_tenant and o.party_id = pt.id and o.status <> 'cancelled'
       and (o.category is distinct from 'maas' or v_gm)
  ) it on true
  left join lateral (
    select sum(e.amount) filter (where e.direction = 'in') as paid_in,
           sum(e.amount) filter (where e.direction = 'out') as paid_out,
           max(e.entry_date) as last_d
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
     where e.tenant_id = v_tenant and e.party_id = pt.id and e.voided_at is null and e.kind in ('income', 'expense')
       and (e.category is distinct from 'maas' or v_gm)
  ) en on true
  where pt.tenant_id = v_tenant and pt.archived_at is null
    and (p_kind is null or pt.kind = p_kind)
    and (v_q is null or pg_catalog.strpos(pg_catalog.lower(pt.name), v_q) > 0)
  order by pt.name
  limit 2000;
end;
$$;

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
  if not exists (select 1 from public.finance_parties pt where pt.id = p_party_id and pt.tenant_id = v_tenant) then
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

create or replace function public.finance_open_item_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('delete');
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_item public.finance_open_items%rowtype;
begin
  if p_id is null or char_length(v_reason) not between 3 and 300 then perform public.finance_v2_raise('invalid_input'); end if;
  select * into v_item from public.finance_open_items o where o.id = p_id and o.tenant_id = v_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_item.category = 'maas' and not public.finance_is_owner_gm() then perform public.finance_v2_raise('forbidden'); end if;
  if v_item.status not in ('open', 'partial') then perform public.finance_v2_raise('item_closed'); end if;
  update public.finance_open_items o
     set status = 'cancelled', cancelled_at = pg_catalog.now(), cancel_reason = v_reason
   where o.id = p_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, auth.uid(), 'finance_open_item.cancel', 'finance_open_item', p_id,
    jsonb_build_object('amount', v_item.amount, 'paid_amount', v_item.paid_amount), jsonb_build_object('reason', v_reason));
end;
$$;

create or replace function public.finance_open_item_settle(p_id uuid, p_account_id uuid, p_amount numeric default null,
  p_date date default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_item public.finance_open_items%rowtype;
  v_wh_left numeric;
  v_cash_left numeric;
  v_amount numeric;
  v_id uuid;
begin
  if p_id is null or p_account_id is null then perform public.finance_v2_raise('invalid_input'); end if;
  select * into v_item from public.finance_open_items o where o.id = p_id and o.tenant_id = v_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_item.status not in ('open', 'partial') then perform public.finance_v2_raise('item_closed'); end if;
  if exists (select 1 from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant)
     and not public.finance_account_is_office(p_account_id) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  v_wh_left := case when coalesce(v_item.withholding_amount, 0) > 0 and not exists (
                      select 1 from public.cash_entries e
                       where e.open_item_id = p_id and e.voided_at is null and coalesce(e.withholding_amount, 0) > 0)
                    then v_item.withholding_amount else 0 end;
  v_cash_left := v_item.amount - v_item.paid_amount - v_wh_left;
  v_amount := coalesce(p_amount, v_cash_left);
  if v_amount < 0.01 or pg_catalog.round(v_amount, 2) <> v_amount or v_amount > v_cash_left + 0.005 then
    perform public.finance_v2_raise('amount_exceeds_open');
  end if;

  v_id := public.finance_record_entry_v2(jsonb_build_object(
    'account_id', p_account_id,
    'direction', case when v_item.direction = 'receivable' then 'in' else 'out' end,
    'amount', v_amount,
    'entry_date', coalesce(p_date, v_today),
    'category', coalesce(v_item.category, case when v_item.direction = 'receivable' then 'diger_gelir' else 'diger_gider' end),
    'title', v_item.title,
    'party_id', v_item.party_id,
    'property_id', v_item.property_id,
    'open_item_id', v_item.id,
    'note', p_note));

  if v_wh_left > 0 and v_amount >= v_cash_left - 0.005 then
    update public.cash_entries e set withholding_amount = v_wh_left where e.id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.finance_aging(p_direction text)
returns table (bucket text, cnt integer, amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('view');
  v_gm boolean := public.finance_is_owner_gm();
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
begin
  if p_direction is null or p_direction not in ('receivable', 'payable') then perform public.finance_v2_raise('invalid_input'); end if;
  return query
  select b.bucket, pg_catalog.count(v.amount_open)::integer, coalesce(sum(v.amount_open), 0)::numeric
  from (values ('vadesi_gelmedi', 0), ('0-30', 1), ('31-60', 2), ('61-90', 3), ('90+', 4)) b(bucket, ord)
  left join (
    select o.amount_open,
           case when o.due_date >= v_today then 'vadesi_gelmedi'
                when v_today - o.due_date <= 30 then '0-30'
                when v_today - o.due_date <= 60 then '31-60'
                when v_today - o.due_date <= 90 then '61-90'
                else '90+' end as bk
      from public.finance_open_items_v o
     where o.tenant_id = v_tenant and o.direction = p_direction and o.amount_open > 0 and o.currency = 'TRY'
       and (o.category is distinct from 'maas' or v_gm) and public.finance_v2_source_visible(o.source)
  ) v on v.bk = b.bucket
  group by b.bucket, b.ord
  order by b.ord;
end;
$$;

-- 001100 / 001000 tanımları (P12 kontrolü olmadan); yardımcı düşmeden önce.
create or replace function public.finance_record_entry_v2(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_dir text := p ->> 'direction';
  v_account uuid;
  v_to_account uuid;
  v_amount numeric;
  v_date date;
  v_cat text := nullif(pg_catalog.btrim(coalesce(p ->> 'category', '')), '');
  v_title text := nullif(pg_catalog.btrim(coalesce(p ->> 'title', '')), '');
  v_vat_rate numeric;
  v_included boolean;
  v_wh_rate numeric;
  v_property uuid;
  v_item_id uuid;
  v_party uuid;
  v_source_type text := coalesce(nullif(p ->> 'source_type', ''), 'manual');
  v_source_id uuid;
  v_expense_id uuid;
  v_create_expense boolean;
  v_rule uuid;
  v_att uuid[];
  v_amt record;
  v_item public.finance_open_items%rowtype;
  v_acc_currency text;
  v_counterparty text;
  v_res jsonb;
  v_id uuid;
begin
  if auth.uid() is null then perform public.finance_v2_raise('unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then perform public.finance_v2_raise('unauthorized'); end if;
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;

  begin
    v_account := nullif(p ->> 'account_id', '')::uuid;
    v_to_account := nullif(p ->> 'to_account_id', '')::uuid;
    v_amount := nullif(p ->> 'amount', '')::numeric;
    v_date := coalesce(nullif(p ->> 'entry_date', '')::date, v_today);
    v_vat_rate := nullif(p ->> 'vat_rate', '')::numeric;
    v_included := coalesce(nullif(p ->> 'vat_included', '')::boolean, true);
    v_wh_rate := nullif(p ->> 'withholding_rate', '')::numeric;
    v_property := nullif(p ->> 'property_id', '')::uuid;
    v_item_id := nullif(p ->> 'open_item_id', '')::uuid;
    v_party := nullif(p ->> 'party_id', '')::uuid;
    v_source_id := nullif(p ->> 'source_id', '')::uuid;
    v_expense_id := nullif(p ->> 'expense_id', '')::uuid;
    v_create_expense := coalesce(nullif(p ->> 'create_expense', '')::boolean, false);
    v_rule := nullif(p ->> 'rule_id', '')::uuid;
    if pg_catalog.jsonb_typeof(p -> 'attachment_ids') = 'array' then
      select pg_catalog.array_agg(x::uuid) into v_att from pg_catalog.jsonb_array_elements_text(p -> 'attachment_ids') x;
    end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;

  -- Transfer: eski finance_transfer (iki bacak, tek transaction); dönüş = transfer grubu kimliği.
  if v_dir = 'transfer' then
    v_res := public.finance_transfer(v_account, v_to_account, v_amount, v_date, nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), ''));
    if coalesce(v_res ->> 'outcome', '') <> 'transferred' then perform public.finance_v2_raise(coalesce(v_res ->> 'outcome', 'error')); end if;
    return (v_res ->> 'transfer_group_id')::uuid;
  end if;

  if v_dir is null or v_dir not in ('in', 'out') or v_account is null
     or v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount
     or (v_vat_rate is not null and (v_vat_rate < 0 or v_vat_rate > 100))
     or (v_wh_rate is not null and (v_wh_rate < 0 or v_wh_rate > 100))
     or coalesce(pg_catalog.array_length(v_att, 1), 0) > 20 then
    perform public.finance_v2_raise('invalid_input');
  end if;

  select * into v_amt from public.finance_entry_amounts(v_amount, v_vat_rate, v_included, v_wh_rate);
  if v_amt.cash < 0.01 then perform public.finance_v2_raise('invalid_input'); end if;

  perform public.finance_v2_check_category(v_tenant, v_cat, v_dir);

  v_party := public.finance_v2_resolve_party(v_tenant, v_party, p ->> 'party_name',
    coalesce(nullif(p ->> 'party_kind', ''), case when v_dir = 'in' then 'musteri' else 'tedarikci' end));
  v_counterparty := coalesce(nullif(pg_catalog.btrim(coalesce(p ->> 'counterparty', '')), ''),
                             (select pt.name from public.finance_parties pt where pt.id = v_party));
  if v_title is null then
    v_title := pg_catalog.left(coalesce(v_counterparty, case when v_dir = 'in' then 'Gelir' else 'Gider' end), 160);
  end if;

  if v_property is not null and not exists (select 1 from public.properties pr where pr.id = v_property and pr.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  if v_item_id is not null then
    select * into v_item from public.finance_open_items o where o.id = v_item_id and o.tenant_id = v_tenant for update;
    if not found then perform public.finance_v2_raise('not_found'); end if;
    select a.currency into v_acc_currency from public.finance_accounts a where a.id = v_account and a.tenant_id = v_tenant;
    -- Ofis kalemi yalnız ofis hesabına tahsil/ödeme olur (kişisel Kasam hesabına kapatma = zimmet riski + cari ekstresinde kayıp).
    if v_acc_currency is not null and not public.finance_account_is_office(v_account) then perform public.finance_v2_raise('invalid_input'); end if;
    if v_item.status not in ('open', 'partial') then perform public.finance_v2_raise('item_closed'); end if;
    if (v_item.direction = 'receivable') <> (v_dir = 'in') or v_acc_currency is distinct from v_item.currency then
      perform public.finance_v2_raise('invalid_input');
    end if;
    if v_amt.cash + coalesce(v_amt.withheld, 0) > v_item.amount - v_item.paid_amount + 0.005 then
      perform public.finance_v2_raise('amount_exceeds_open');
    end if;
    if v_item.category = 'maas' and not public.finance_is_owner_gm() then perform public.finance_v2_raise('forbidden'); end if;
    if v_party is null then v_party := v_item.party_id; end if;
  end if;

  -- Ek (fiş kutusu) yalnız ofis hesabı hareketine bağlanır.
  if v_att is not null and not public.finance_account_is_office(v_account)
     and exists (select 1 from public.finance_accounts a where a.id = v_account and a.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  v_res := public.finance_record_entry(
    v_account, v_dir, v_amt.cash, v_date, v_cat, v_title, v_counterparty,
    nullif(pg_catalog.btrim(coalesce(p ->> 'document_url', '')), ''), nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), ''),
    v_source_type, v_source_id, v_create_expense, nullif(p ->> 'expense_category', ''), v_expense_id);
  if coalesce(v_res ->> 'outcome', '') <> 'recorded' then perform public.finance_v2_raise(coalesce(v_res ->> 'outcome', 'error')); end if;
  v_id := (v_res ->> 'entry_id')::uuid;

  -- create_expense ile AÇILAN gider kaydı belge tutarını taşır (eski RPC nakdi yazar): KDV biliniyorsa KDV hariç net,
  -- bilinmiyorsa brüt; stopaj dahil. Kâr/zarar ve bütçe bu gideri expenses'tan okur → giriş yolundan bağımsız aynı tutar.
  if v_expense_id is null and nullif(v_res ->> 'expense_id', '') is not null then
    update public.expenses x set amount = v_amt.net
     where x.id = (v_res ->> 'expense_id')::uuid and x.tenant_id = v_tenant and x.amount is distinct from v_amt.net;
  end if;

  update public.cash_entries e
     set party_id = v_party,
         vat_rate = v_vat_rate,
         vat_amount = v_amt.vat,
         vat_included = case when v_vat_rate is null then e.vat_included else v_included end,
         withholding_rate = v_wh_rate,
         withholding_amount = v_amt.withheld,
         property_id = v_property,
         open_item_id = v_item_id
   where e.id = v_id and e.tenant_id = v_tenant;

  if v_att is not null then
    update public.finance_attachments fa set entry_id = v_id
     where fa.tenant_id = v_tenant and fa.id = any (v_att) and fa.entry_id is null;
  end if;
  if v_rule is not null then
    update public.finance_rules r set hits = r.hits + 1 where r.id = v_rule and r.tenant_id = v_tenant;
  end if;
  return v_id;
end;
$$;


create or replace function public.finance_rule_upsert(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_id uuid;
  v_dir text := nullif(p ->> 'direction', '');
  v_text text := nullif(pg_catalog.btrim(coalesce(p ->> 'match_text', '')), '');
  v_iban text := nullif(pg_catalog.btrim(coalesce(p ->> 'match_iban_last4', '')), '');
  v_cat text := pg_catalog.btrim(coalesce(p ->> 'set_category', ''));
  v_mode text := coalesce(nullif(p ->> 'mode', ''), 'suggest');
  v_min numeric;
  v_max numeric;
  v_party uuid;
  v_active boolean;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid;
    v_min := nullif(p ->> 'amount_min', '')::numeric;
    v_max := nullif(p ->> 'amount_max', '')::numeric;
    v_party := nullif(p ->> 'set_party_id', '')::uuid;
    v_active := coalesce(nullif(p ->> 'active', '')::boolean, true);
  exception when invalid_text_representation or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;
  if (v_dir is not null and v_dir not in ('in', 'out')) or v_mode not in ('suggest', 'auto')
     or char_length(v_cat) not between 1 and 40
     or (v_text is not null and char_length(v_text) not between 2 and 100)
     or (v_iban is not null and v_iban !~ '^[0-9]{4}$')
     or (v_min is not null and v_min < 0) or (v_max is not null and v_max < 0) or (v_min is not null and v_max is not null and v_min > v_max)
     or (v_text is null and v_iban is null and v_min is null and v_max is null) then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_cat like 'x\_%' and not exists (select 1 from public.finance_categories c where c.tenant_id = v_tenant and c.key = v_cat and c.archived_at is null) then
    perform public.finance_v2_raise('invalid_category');
  end if;
  if v_party is not null and not exists (select 1 from public.finance_parties pt where pt.id = v_party and pt.tenant_id = v_tenant) then
    perform public.finance_v2_raise('party_not_found');
  end if;

  if v_id is null then
    if (select pg_catalog.count(*) from public.finance_rules r where r.tenant_id = v_tenant) >= 200 then
      perform public.finance_v2_raise('limit_reached');
    end if;
    insert into public.finance_rules (tenant_id, direction, match_text, match_iban_last4, amount_min, amount_max, set_category, set_party_id, mode, active, created_by)
    values (v_tenant, v_dir, v_text, v_iban, v_min, v_max, v_cat, v_party, v_mode, v_active, auth.uid())
    returning id into v_id;
  else
    update public.finance_rules r
       set direction = v_dir, match_text = v_text, match_iban_last4 = v_iban, amount_min = v_min, amount_max = v_max,
           set_category = v_cat, set_party_id = v_party, mode = v_mode, active = v_active
     where r.id = v_id and r.tenant_id = v_tenant;
    if not found then perform public.finance_v2_raise('not_found'); end if;
  end if;
  return v_id;
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

drop function if exists public.finance_party_foreign_advisor(uuid);

notify pgrst, 'reload schema';
