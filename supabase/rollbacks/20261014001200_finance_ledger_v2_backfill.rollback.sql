-- Rollback: 20261014001200_finance_ledger_v2_backfill
-- Veri taşımasını geri alır: taşımanın açtığı (created_by boş) carilerin hareket bağı boşaltılır ve başka yerde kullanılmıyorsa
-- cari satırı silinir; 2000-01-01 tarihli kopya bütçe satırları silinir; muhasebe rolünün expenses create/edit izni kaldırılır.
-- Hareketlerin tutarı/tarihi/hesabı hiç değişmediğinden bakiye etkilenmez. expense_budgets'a dokunulmaz.

set local lock_timeout = '5s';

update public.cash_entries e
   set party_id = null
  from public.finance_parties p
 where e.party_id = p.id and p.created_by is null;

delete from public.finance_parties p
 where p.created_by is null
   and not exists (select 1 from public.cash_entries e where e.party_id = p.id)
   and not exists (select 1 from public.finance_open_items o where o.party_id = p.id)
   and not exists (select 1 from public.recurring_rules r where r.party_id = p.id)
   and not exists (select 1 from public.finance_rules fr where fr.set_party_id = p.id);

delete from public.finance_budgets fb
 where fb.period_month = date '2000-01-01' and fb.direction = 'out'
   and exists (select 1 from public.expense_budgets b
                where b.tenant_id = fb.tenant_id and b.category = fb.category and b.monthly_amount = fb.amount);

delete from public.permission_defaults
 where role = 'accounting' and module = 'expenses' and action in ('create', 'edit');
