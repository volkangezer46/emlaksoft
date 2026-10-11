-- Rollback: 20261011001100_finance_salary_privacy_void_audit
-- İki fonksiyon gövdesini önceki (20261010000600) hâline döndürür. Veri değişmediği için kayıp yoktur.
-- NOT: geri alma maaş bakiye sızıntısını yeniden açar ve kaynak bağlı iptal audit'ini kaldırır.
create or replace function public.finance_account_balances()
returns table(account_id uuid, balance numeric, total_in numeric, total_out numeric, entry_count bigint, last_entry_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         a.opening_balance + coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0),
         coalesce(sum(case when e.direction = 'in' then e.amount end), 0),
         coalesce(sum(case when e.direction = 'out' then e.amount end), 0),
         count(e.id),
         max(e.entry_date)
  from public.finance_accounts a
  left join public.cash_entries e on e.account_id = a.id and e.tenant_id = a.tenant_id and e.voided_at is null
  where a.tenant_id = public.current_active_tenant_id()
    and ((a.owner_scope = 'user' and a.owner_user_id = auth.uid())
         or (a.owner_scope = 'office' and public.has_effective_permission('expenses', 'view')))
  group by a.id, a.opening_balance;
$$;

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
  update public.cash_entries e set voided_at = pg_catalog.now(), voided_by = v_uid,
    void_reason = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''), 'Tahsilat geri alındı'), 300)
  from public.finance_accounts a
  where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.voided_at is null
    and a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office';
  get diagnostics v_n = row_count;
  return jsonb_build_object('outcome', 'voided', 'count', v_n);
end;
$$;
