-- Gider bütçesi + tekrarlayan gider + portal gideri eşlemesi (gelir artır / gider düşür turu).
--
-- NEDEN: Ofisler kategori bazlı aylık bütçe koyamıyor, abonelik/kira gibi tekrarlayan giderlerin yenilemesini
--   unutuyor ve portal aboneliğinin getirisini (talep/anlaşma başına maliyet) göremiyor.
-- İÇERİK:
--   1) public.expense_budgets: kategori başına aylık bütçe (tenant + kategori benzersiz). RLS: okuma giderler:görüntüle,
--      yazma giderler:düzenle (tenant_id = current_active_tenant_id()).
--   2) expenses.recurrence: null | 'monthly' | 'quarterly' | 'yearly' (tekrarlayan gider; yenileme tarihi koddan türer).
--   3) expenses.portal_key: null | 'sahibinden' | 'hepsiemlak' | 'zingat' | 'emlakjet' (portal ROI eşlemesi).
-- Mevcut satırlar DEĞİŞMEZ (yeni sütunlar null). Hiçbir veri taşınmaz/silinmez.
-- BAĞIMLILIK: 20260723000031 (expenses), 20260802000300 (current_active_tenant_id / has_effective_permission).
-- GERİ ALMA: rollbacks/20261008000700_expense_budgets_recurring_portal.rollback.sql (bütçe tablosu + iki sütun düşer).
-- RİSK: düşük (ek tablo + null'lanabilir iki sütun; kod sütunlar yokken eski davranışa düşer).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.expenses') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null then
    raise exception '20261008000700: taban sema eksik (expenses / has_effective_permission / current_active_tenant_id).';
  end if;
end $$;

-- 1) Kategori bazlı aylık bütçe
create table if not exists public.expense_budgets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  category       text not null check (char_length(category) between 1 and 60),
  monthly_amount numeric(14,2) not null check (monthly_amount > 0),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint expense_budgets_tenant_category_key unique (tenant_id, category)
);

comment on table public.expense_budgets is 'Kategori bazlı aylık gider bütçesi (Giderler > Bütçe). %80/%100 aşımı içgörü motoruna girer.';

alter table public.expense_budgets enable row level security;

drop policy if exists expense_budgets_select on public.expense_budgets;
create policy expense_budgets_select on public.expense_budgets
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'view'))
  );

drop policy if exists expense_budgets_insert on public.expense_budgets;
create policy expense_budgets_insert on public.expense_budgets
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'edit'))
  );

drop policy if exists expense_budgets_update on public.expense_budgets;
create policy expense_budgets_update on public.expense_budgets
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'edit'))
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'edit'))
  );

drop policy if exists expense_budgets_delete on public.expense_budgets;
create policy expense_budgets_delete on public.expense_budgets
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'edit'))
  );

revoke all on table public.expense_budgets from public, anon, authenticated;
grant select, insert, update, delete on table public.expense_budgets to authenticated;
grant all on table public.expense_budgets to service_role;

-- 2) Tekrarlayan gider + 3) portal eşlemesi
alter table public.expenses
  add column if not exists recurrence text,
  add column if not exists portal_key text;

alter table public.expenses drop constraint if exists expenses_recurrence_check;
alter table public.expenses
  add constraint expenses_recurrence_check
  check (recurrence is null or recurrence in ('monthly', 'quarterly', 'yearly'));

alter table public.expenses drop constraint if exists expenses_portal_key_check;
alter table public.expenses
  add constraint expenses_portal_key_check
  check (portal_key is null or portal_key in ('sahibinden', 'hepsiemlak', 'zingat', 'emlakjet'));

comment on column public.expenses.recurrence is 'Tekrarlayan gider dönemi: monthly | quarterly | yearly (null = tek seferlik). Yenileme tarihi = son kayıt + dönem.';
comment on column public.expenses.portal_key is 'Portal aboneliği/reklam gideri ise hangi portal (ROI: talep/anlaşma başına maliyet).';

create index if not exists idx_expenses_tenant_recurrence
  on public.expenses (tenant_id, expense_date desc) where recurrence is not null;
create index if not exists idx_expenses_tenant_portal
  on public.expenses (tenant_id, portal_key, expense_date desc) where portal_key is not null;

notify pgrst, 'reload schema';
