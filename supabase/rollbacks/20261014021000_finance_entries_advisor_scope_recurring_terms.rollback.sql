-- Rollback: 20261014021000_finance_entries_advisor_scope_recurring_terms
-- cash_entries_select 20261010000600 tanımına, finance_statement_apply'daki düzenli ödeme çağrısı 3 argümana,
-- recurring_post_occurrence(uuid,numeric,uuid) 20261010000900 gövdesine döner; 4 argümanlı sürüm düşer.
-- Veri değişmez: bu sürede KDV/stopaj/cari ile açılmış hareketler olduğu gibi kalır (geçerli v2 satırlarıdır).

set local lock_timeout = '5s';

drop policy if exists cash_entries_select on public.cash_entries;
create policy cash_entries_select on public.cash_entries
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (
      select 1 from public.finance_accounts a
      where a.id = cash_entries.account_id and a.tenant_id = cash_entries.tenant_id
        and (a.owner_scope = 'user' or cash_entries.category is distinct from 'maas' or (select public.finance_is_owner_gm()))
    )
  );

do $$
declare
  v_def text := pg_catalog.pg_get_functiondef('public.finance_statement_apply(uuid,jsonb)'::regprocedure);
  v_new constant text := 'public.recurring_post_occurrence(v_occ.id, v_line.amount, v_uid, true)';
  v_old constant text := 'public.recurring_post_occurrence(v_occ.id, v_line.amount, v_uid)';
begin
  if pg_catalog.strpos(v_def, v_new) > 0 then
    execute pg_catalog.replace(v_def, v_new, v_old);
  end if;
end
$$;

-- 20261010000900 gövdesi (birebir).
create or replace function public.recurring_post_occurrence(p_occ_id uuid, p_amount numeric, p_actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.recurring_occurrences%rowtype;
  r public.recurring_rules%rowtype;
  a public.finance_accounts%rowtype;
  v_amount numeric;
  v_exp uuid;
  v_created boolean := false;
  v_entry uuid;
begin
  select * into o from public.recurring_occurrences x where x.id = p_occ_id and x.status = 'pending' for update;
  if not found then return 'not_found'; end if;
  select * into r from public.recurring_rules x where x.id = o.rule_id;
  select * into a from public.finance_accounts x where x.id = r.account_id and x.tenant_id = r.tenant_id;
  if not found then return 'not_found'; end if;
  v_amount := coalesce(p_amount, o.amount);
  if v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount then
    return 'invalid_input';
  end if;
  if a.archived_at is not null then return 'archived'; end if;
  if o.due_date < a.opening_date then return 'before_opening'; end if;

  -- Ofis gideri: TL ofis hesabından çıkan, maaş olmayan kural expenses kaydı da üretir (Paket A kuralı).
  if r.scope = 'office' and r.direction = 'out' and r.create_expense and a.owner_scope = 'office'
     and a.currency = 'TRY' and r.category <> 'maas' then
    insert into public.expenses (tenant_id, created_by, category, title, amount, currency, expense_date, notes, portal_key)
    values (r.tenant_id, p_actor, coalesce(r.expense_category, 'diger'), r.title, v_amount, 'TRY', o.due_date, 'Düzenli ödeme', r.portal_key)
    returning id into v_exp;
    v_created := true;
  end if;

  begin
    insert into public.cash_entries (tenant_id, account_id, direction, amount, currency, entry_date, kind, category, title,
      expense_id, created_expense, source_type, source_id, created_by)
    values (r.tenant_id, r.account_id, r.direction, v_amount, a.currency, o.due_date,
      case when r.direction = 'in' then 'income' else 'expense' end, r.category, r.title,
      v_exp, v_created, 'recurring', o.id, p_actor)
    returning id into v_entry;
  exception when unique_violation then
    -- Aynı dönem başka yoldan işlenmiş: üretilen gider kaydı yetim kalmasın.
    if v_exp is not null then delete from public.expenses where id = v_exp; end if;
    return 'duplicate';
  end;

  update public.recurring_occurrences
     set status = 'posted', amount = v_amount, entry_id = v_entry, decided_by = p_actor, decided_at = pg_catalog.now(), skip_reason = null
   where id = o.id;
  if r.scope = 'office' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
    values (r.tenant_id, p_actor, 'recurring.post', 'recurring_rule', r.id,
      jsonb_build_object('period', o.period, 'amount', v_amount, 'entry_id', v_entry, 'mode', r.mode));
  end if;
  return 'posted';
end;
$$;


revoke all on function public.recurring_post_occurrence(uuid, numeric, uuid) from public, anon, authenticated;
drop function if exists public.recurring_post_occurrence(uuid, numeric, uuid, boolean);

notify pgrst, 'reload schema';
