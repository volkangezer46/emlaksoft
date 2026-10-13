-- FN3 (2026-10-13): Muhasebe > Hareketler — toplu "Mutabık işaretle" / "Mutabakatı kaldır".
--
-- Ekstre yüklenmeyen hesaplarda (kasa, ekstresi kağıtta gelen banka) hareketler elle mutabık işaretlenebilir.
-- Yeni RPC finance_entries_set_reconciled(p_ids, p_reconciled):
--   * yalnız kendi ofisinin, iptal edilmemiş gelir/gider/transfer hareketleri (düzeltme kaydı hariç);
--   * hesap erişimi finance_account_access(.., 'edit') (ofis hesabı: expenses:edit; kişisel hesap: yalnız sahibi);
--   * ofis hesabındaki maaş hareketi yalnız sahip/genel müdür (ekstre eşleştirmesiyle aynı kural);
--   * yalnız reconciled_at değişir (parasal alan değil; dönem kilidi tetiği bu güncellemeyi engellemez);
--   * işaretlenen/kaldırılan satır sayısını döner, uygun olmayan satırlar sessizce değil sayıyla atlanır (istemci yazar).
-- Ekstre satırı eşleşmesi (finance_statement_lines.entry_id) DEĞİŞMEZ: mutabakatı kaldırmak eşleşmeyi silmez.
--
-- Yeni nesne ekler, mevcut veriye dokunmaz; idempotent (create or replace). Geri alma: supabase/rollbacks/20261013008200_*.

create or replace function public.finance_entries_set_reconciled(p_ids uuid[], p_reconciled boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_n integer := 0;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_ids is null or p_reconciled is null or coalesce(pg_catalog.array_length(p_ids, 1), 0) not between 1 and 500 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  with target as (
    select e.id
      from public.cash_entries e
      join public.finance_accounts a on a.id = e.account_id and a.tenant_id = e.tenant_id
     where e.tenant_id = v_tenant
       and e.id = any (p_ids)
       and e.voided_at is null
       and e.kind in ('income', 'expense', 'transfer')
       and (case when p_reconciled then e.reconciled_at is null else e.reconciled_at is not null end)
       and public.finance_account_access(e.account_id, 'edit')
       and (e.category is distinct from 'maas' or a.owner_scope = 'user' or public.finance_is_owner_gm())
     for update of e
  )
  update public.cash_entries e
     set reconciled_at = case when p_reconciled then pg_catalog.now() else null end
    from target t
   where e.id = t.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.finance_entries_set_reconciled(uuid[], boolean) is
  'FN3: hareketleri elle mutabik isaretler / mutabakati kaldirir (yalniz reconciled_at; hesap edit erisimi + maas gizliligi).';

revoke all privileges on function public.finance_entries_set_reconciled(uuid[], boolean) from public, anon;
grant execute on function public.finance_entries_set_reconciled(uuid[], boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
