-- UYGULANMADI (canlıya henüz uygulanmadı; sahibin onayı + yedek doğrulaması sonrası `npm run db:migrate`).
--
-- GP1 — Finans güvenliği: danışman carisi kapsamı (P12) veritabanında + yaşlandırmada 'vadesiz' kovası.
-- 20261014001000 (şema) + 20261014001100 (RPC) SONRASI.
--
-- 1) P12 kazanç gizliliği şimdiye dek yalnız arayüzdeydi (party-list/party-detail/open-items süzgeci): `earnings_all`
--    izni olmayan kullanıcı başka danışmanın carisini (bakiye, ekstre, açık kalem) RPC'yi doğrudan çağırarak okuyabiliyordu.
--    Kural (arayüzle birebir): türü 'danisman' olan cari yalnız `user_id = auth.uid()` iken ya da `earnings_all:view`
--    varsa görünür; kullanıcıya bağlanmamış danışman carisi de kapalıdır (kime ait olduğu bilinmiyor).
--    Uygulandığı yerler: finance_parties / finance_open_items SELECT politikaları (security_invoker görünüm
--    finance_open_items_v elle kalemlerde bunu devralır), finance_party_balances / _statement / _upsert / _set_archived,
--    finance_open_item_cancel / _settle, finance_aging ve cari çözümü (finance_v2_resolve_party: id ile verilemez,
--    adla eşleşmez). Gizli cari için hata `not_found` / `party_not_found`'tır (varlığı söylenmez).
-- 2) finance_aging: vadesi olmayan (due_date null) kalem CASE'te hiçbir dala uymadığı için '90+'ya düşüyordu; artık ayrı
--    'vadesiz' kovası (ord 5) var ve gecikmiş sayılmaz. İmza ve dönüş tipi aynı (yalnız bir kova satırı eklendi).
-- Fonksiyon imzaları ve yetkileri (grant/revoke) DEĞİŞMEZ; `create or replace` mevcut ACL'yi korur.
-- GERİ ALMA: supabase/rollbacks/20261014011000_finance_party_advisor_scope.rollback.sql (001100 gövdelerine döner).
-- RİSK: düşük-orta (RLS sıkılaşır: earnings_all olmayan, expenses:view sahibi özel rollerde başka danışmanın carisi
-- listeden düşer; varsayılan rollerden expenses görenlerin hepsinde earnings_all var).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_parties') is null
     or pg_catalog.to_regclass('public.finance_open_items_v') is null
     or pg_catalog.to_regprocedure('public.finance_aging(text)') is null
     or pg_catalog.to_regprocedure('public.finance_v2_resolve_party(uuid,uuid,text,text)') is null then
    raise exception '20261014011000: önce 20261014001000 ve 20261014001100 (finans v2) uygulanmalı.';
  end if;
end $$;

-- Cari, oturumdaki kullanıcıya ait OLMAYAN bir danışman carisi mi (kullanıcıya bağlanmamış danışman carisi de "başkası").
-- `earnings_all` kontrolünü çağıran yapar (RLS'te InitPlan ile bir kez). SECURITY DEFINER: politika içinde cari satırı
-- RLS'e takılmadan okunur (aksi halde gizli cari "yok" sayılıp kalem görünür kalırdı). Yalnız boolean döner.
create or replace function public.finance_party_foreign_advisor(p_party_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.finance_parties p
     where p.id = p_party_id and p.kind = 'danisman' and p.user_id is distinct from auth.uid()
  );
$$;

revoke all on function public.finance_party_foreign_advisor(uuid) from public, anon;
grant execute on function public.finance_party_foreign_advisor(uuid) to authenticated, service_role;

drop policy if exists finance_parties_select on public.finance_parties;
create policy finance_parties_select on public.finance_parties
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'view'))
    and (kind <> 'danisman' or user_id = (select auth.uid()) or (select public.has_effective_permission('earnings_all', 'view')))
  );

drop policy if exists finance_open_items_select on public.finance_open_items;
create policy finance_open_items_select on public.finance_open_items
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'view'))
    and (category is distinct from 'maas' or (select public.finance_is_owner_gm()))
    and (party_id is null or (select public.has_effective_permission('earnings_all', 'view')) or not public.finance_party_foreign_advisor(party_id))
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
  v_all boolean := public.has_effective_permission('earnings_all', 'view');
begin
  if p_party_id is not null then
    select p.id into v_id from public.finance_parties p where p.id = p_party_id and p.tenant_id = p_tenant;
    if v_id is null or (not v_all and public.finance_party_foreign_advisor(v_id)) then perform public.finance_v2_raise('party_not_found'); end if;
    return v_id;
  end if;
  if v_name = '' then return null; end if;
  if char_length(v_name) > 120 or v_kind not in ('musteri', 'malik', 'kiraci', 'tedarikci', 'danisman', 'diger') then
    perform public.finance_v2_raise('invalid_input');
  end if;
  select p.id into v_id from public.finance_parties p
   where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.archived_at is null
     and (v_all or p.kind <> 'danisman' or p.user_id = auth.uid())
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
    -- Ad çakışması başka danışmanın carisine düştüyse bağlanmaz (varlığı da söylenmez).
    if v_id is not null and not v_all and public.finance_party_foreign_advisor(v_id) then perform public.finance_v2_raise('party_not_found'); end if;
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
  if v_id is not null and not public.has_effective_permission('earnings_all', 'view') and public.finance_party_foreign_advisor(v_id) then
    perform public.finance_v2_raise('not_found');
  end if;

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
  if not public.has_effective_permission('earnings_all', 'view') and public.finance_party_foreign_advisor(p_id) then perform public.finance_v2_raise('not_found'); end if;
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
  v_all boolean := public.has_effective_permission('earnings_all', 'view');
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
    and (v_all or pt.kind <> 'danisman' or pt.user_id = auth.uid())
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
  if v_item.party_id is not null and not public.has_effective_permission('earnings_all', 'view')
     and public.finance_party_foreign_advisor(v_item.party_id) then
    perform public.finance_v2_raise('not_found');
  end if;
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
  if v_item.party_id is not null and not public.has_effective_permission('earnings_all', 'view')
     and public.finance_party_foreign_advisor(v_item.party_id) then
    perform public.finance_v2_raise('not_found');
  end if;
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
  v_all boolean := public.has_effective_permission('earnings_all', 'view');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
begin
  if p_direction is null or p_direction not in ('receivable', 'payable') then perform public.finance_v2_raise('invalid_input'); end if;
  return query
  select b.bucket, pg_catalog.count(v.amount_open)::integer, coalesce(sum(v.amount_open), 0)::numeric
  from (values ('vadesi_gelmedi', 0), ('0-30', 1), ('31-60', 2), ('61-90', 3), ('90+', 4), ('vadesiz', 5)) b(bucket, ord)
  left join (
    select o.amount_open,
           case when o.due_date is null then 'vadesiz'
                when o.due_date >= v_today then 'vadesi_gelmedi'
                when v_today - o.due_date <= 30 then '0-30'
                when v_today - o.due_date <= 60 then '31-60'
                when v_today - o.due_date <= 90 then '61-90'
                else '90+' end as bk
      from public.finance_open_items_v o
     where o.tenant_id = v_tenant and o.direction = p_direction and o.amount_open > 0 and o.currency = 'TRY'
       and (o.category is distinct from 'maas' or v_gm) and public.finance_v2_source_visible(o.source)
       and (o.party_id is null or v_all or not public.finance_party_foreign_advisor(o.party_id))
  ) v on v.bk = b.bucket
  group by b.bucket, b.ord
  order by b.ord;
end;
$$;

comment on function public.finance_party_foreign_advisor(uuid) is
  'P12: cari oturumdaki kullanıcıya ait olmayan danışman carisi mi (earnings_all kontrolü çağıranda). RLS ve finance_party_* RPC''leri kullanır.';

notify pgrst, 'reload schema';
