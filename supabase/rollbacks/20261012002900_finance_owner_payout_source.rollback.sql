-- 20261012002900 geri alma: finance_record_entry 20261012001400 gövdesine, finance_void_source_entries 20261011001100 gövdesine döner;
-- cash_entries.source_type CHECK'i 'owner_payout' olmadan geri konur. Önce owner_payout kaynaklı hareketler varsa kontrol NOT VALID eklenir
-- (mevcut satırları doğrulamaz; yeni owner_payout yazılamaz). Satırlar elle iptal/temizlendikten sonra `validate constraint` çalıştırılabilir.

do $$
declare c record;
begin
  for c in select con.conname from pg_catalog.pg_constraint con
            where con.conrelid = 'public.cash_entries'::regclass and con.contype = 'c'
              and pg_catalog.pg_get_constraintdef(con.oid) like '%source_type%' loop
    execute pg_catalog.format('alter table public.cash_entries drop constraint %I', c.conname);
  end loop;
  alter table public.cash_entries add constraint cash_entries_source_type_check
    check (source_type in ('manual', 'commission', 'rent', 'due', 'building', 'recurring', 'import')) not valid;
end $$;

create or replace function public.finance_record_entry(
  p_account_id uuid, p_direction text, p_amount numeric, p_entry_date date, p_category text, p_title text,
  p_counterparty text default null, p_document_url text default null, p_note text default null,
  p_source_type text default 'manual', p_source_id uuid default null,
  p_create_expense boolean default false, p_expense_category text default null, p_expense_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_cat text := nullif(pg_catalog.btrim(coalesce(p_category, '')), '');
  v_acc public.finance_accounts%rowtype;
  v_exp uuid;
  v_created boolean := false;
  v_id uuid;
  v_dup uuid;
  v_cap numeric;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if public.current_profile_role() = 'readonly' then return jsonb_build_object('outcome', 'forbidden'); end if;

  if p_account_id is null or p_direction not in ('in', 'out')
     or p_amount is null or p_amount < 0.01 or p_amount > 9999999999.99 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_entry_date is null or p_entry_date > v_today or p_entry_date < date '2000-01-01'
     or char_length(v_title) not between 1 and 160
     or (v_cat is not null and char_length(v_cat) > 40)
     or char_length(coalesce(p_counterparty, '')) > 120
     or char_length(coalesce(p_note, '')) > 1000
     or (p_document_url is not null and (char_length(p_document_url) > 500 or p_document_url !~ '^https://'))
     or p_source_type not in ('manual', 'commission', 'rent', 'building')
     or (p_source_type <> 'manual' and p_source_id is null)
     or (p_source_type = 'manual' and p_source_id is not null) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select * into v_acc from public.finance_accounts a where a.id = p_account_id and a.tenant_id = v_tenant for share;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_acc.archived_at is not null then return jsonb_build_object('outcome', 'archived'); end if;
  if p_entry_date < v_acc.opening_date then return jsonb_build_object('outcome', 'before_opening', 'opening_date', v_acc.opening_date); end if;

  if p_source_type = 'manual' then
    if not public.finance_account_access(p_account_id, 'create') then return jsonb_build_object('outcome', 'forbidden'); end if;
  else
    -- Tahsilat bağlı hareket yalnız ofis hesabına GİRİŞ olur; yetki tahsilatı yapan modülün düzenleme yetkisidir.
    if v_acc.owner_scope <> 'office' or p_direction <> 'in' then return jsonb_build_object('outcome', 'invalid_input'); end if;
    if not (case p_source_type
              when 'commission' then public.has_effective_permission('commissions', 'edit')
              when 'rent' then public.has_effective_permission('rentals', 'edit')
              else public.has_effective_permission('expenses', 'edit') end) then
      return jsonb_build_object('outcome', 'forbidden');
    end if;
    if not (case p_source_type
              when 'commission' then exists (select 1 from public.commissions c where c.id = p_source_id and c.tenant_id = v_tenant)
              when 'rent' then exists (select 1 from public.rent_payments r where r.id = p_source_id and r.tenant_id = v_tenant and r.voided_at is null)
              else exists (select 1 from public.building_payments b where b.id = p_source_id and b.tenant_id = v_tenant and b.voided_at is null) end) then
      return jsonb_build_object('outcome', 'source_not_found');
    end if;
    -- Mükerrer kontrolü HESAPTAN BAĞIMSIZ (statement_apply 20261011001400 ile aynı mantık): aynı tahsilat başka hesaba da yazılamaz.
    select e.id into v_dup from public.cash_entries e
     where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.voided_at is null
     order by e.created_at, e.id
     limit 1;
    if v_dup is not null then return jsonb_build_object('outcome', 'duplicate', 'entry_id', v_dup); end if;
    -- Tutar tavanı: kaynak kaydın tutarını aşan tahsilat hareketi yazılamaz (eşitlik aranmaz; kısmi tahsilat serbest).
    -- Kaynak tutarlar TL'dir; hesap TL değilse (kur bilinmez) tavan UYGULANMAZ.
    -- Komisyon için paid/collected şartı ARANMAZ: toplu tahsilat önce paid yapar, sonra hareketi yazar.
    if v_acc.currency = 'TRY' then
      v_cap := case p_source_type
                 when 'commission' then (select c.gross_amount + greatest(coalesce(c.vat_amount, 0), 0)
                                           from public.commissions c where c.id = p_source_id and c.tenant_id = v_tenant)
                 when 'rent' then (select r.amount from public.rent_payments r where r.id = p_source_id and r.tenant_id = v_tenant)
                 else (select b.amount from public.building_payments b where b.id = p_source_id and b.tenant_id = v_tenant)
               end;
      if v_cap is not null and p_amount > v_cap then
        return jsonb_build_object('outcome', 'invalid_input', 'reason', 'amount_exceeds_source');
      end if;
    end if;
  end if;

  if v_cat = 'maas' and v_acc.owner_scope = 'office' and not public.finance_is_owner_gm() then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  -- Var olan bir gider kaydına bağlama (Giderler'deki ayrıntılı gider formu): aynı ofisin, henüz hareketi olmayan gideri.
  if p_expense_id is not null then
    if p_direction <> 'out' or p_source_type <> 'manual' or v_acc.owner_scope <> 'office'
       or not exists (select 1 from public.expenses x where x.id = p_expense_id and x.tenant_id = v_tenant) then
      return jsonb_build_object('outcome', 'invalid_input');
    end if;
    if exists (select 1 from public.cash_entries e where e.expense_id = p_expense_id and e.voided_at is null) then
      return jsonb_build_object('outcome', 'duplicate');
    end if;
    v_exp := p_expense_id;
  end if;

  -- Ofis gideri: TL ofis hesabından çıkan, maaş olmayan elle gider isteğe bağlı expenses kaydı üretir (aynı transaction).
  if v_exp is null and p_create_expense and p_direction = 'out' and p_source_type = 'manual' and v_acc.owner_scope = 'office'
     and v_acc.currency = 'TRY' and v_cat is distinct from 'maas' then
    insert into public.expenses (tenant_id, created_by, category, title, amount, currency, expense_date, notes, receipt_url)
    values (v_tenant, v_uid, coalesce(nullif(pg_catalog.btrim(coalesce(p_expense_category, '')), ''), 'diger'), v_title, p_amount, 'TRY',
            p_entry_date, nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), p_document_url)
    returning id into v_exp;
    v_created := true;
  end if;

  begin
    insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title, counterparty,
      document_url, note, expense_id, created_expense, source_type, source_id, created_by)
    values (v_tenant, p_account_id, p_direction, p_amount, v_acc.currency, p_entry_date,
      case when p_direction = 'in' then 'income' else 'expense' end, v_cat, v_title,
      nullif(pg_catalog.btrim(coalesce(p_counterparty, '')), ''), p_document_url, nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
      v_exp, v_created, p_source_type, p_source_id, v_uid)
    returning id into v_id;
  exception when unique_violation then
    if p_expense_id is not null then return jsonb_build_object('outcome', 'duplicate'); end if;
    select e.id into v_dup from public.cash_entries e
     where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.voided_at is null
     order by e.created_at, e.id
     limit 1;
    if v_dup is not null then return jsonb_build_object('outcome', 'duplicate', 'entry_id', v_dup); end if;
    raise;
  end;

  if v_acc.owner_scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (v_tenant, v_uid, 'cash_entry.record', 'cash_entry', v_id,
      jsonb_build_object('account_id', p_account_id, 'direction', p_direction, 'amount', p_amount, 'source_type', p_source_type, 'expense_id', v_exp));
  end if;
  return jsonb_build_object('outcome', 'recorded', 'entry_id', v_id, 'expense_id', v_exp);
end;
$$;

revoke all on function public.finance_record_entry(uuid, text, numeric, date, text, text, text, text, text, text, uuid, boolean, text, uuid) from public, anon;
grant execute on function public.finance_record_entry(uuid, text, numeric, date, text, text, text, text, text, text, uuid, boolean, text, uuid) to authenticated, service_role;

create or replace function public.finance_void_source_entries(p_source_type text, p_source_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_n integer;
  v_total numeric;
  v_reason text;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_source_type not in ('commission', 'rent', 'building') or p_source_id is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if not (case p_source_type
            when 'commission' then public.has_effective_permission('commissions', 'edit')
            when 'rent' then public.has_effective_permission('rentals', 'delete')
            else public.has_effective_permission('expenses', 'edit') end) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  v_reason := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''), 'Tahsilat geri alındı'), 300);
  with voided as (
    update public.cash_entries e set voided_at = pg_catalog.now(), voided_by = v_uid, void_reason = v_reason
    from public.finance_accounts a
    where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.voided_at is null
      and a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
    returning e.amount
  )
  select count(*), coalesce(sum(amount), 0) into v_n, v_total from voided;
  if v_n > 0 then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (v_tenant, v_uid, 'cash_entry.void_source', p_source_type, p_source_id,
      jsonb_build_object('amount', v_total, 'source_type', p_source_type),
      jsonb_build_object('reason', v_reason, 'legs', v_n));
  end if;
  return jsonb_build_object('outcome', 'voided', 'count', v_n);
end;
$$;
