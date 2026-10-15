-- 20261017010500 geri alma: aidat RPC'leri, depozito RPC'leri, cari tetiği ve yardımcılar düşer; aidat_kpi property_dues'tan okuyan
--   20260729000130 gövdesine, owner_charge_links_insert 20261008001100 haline, property_dues yazma politikaları 20261016100100 haline döner.
-- VERİ: taşınan / yeni açılan aidat açık kalemleri (finance_open_items.source_type='due') SİLİNMEZ (muhasebe kaydıdır); geri alma
--   sonrası yeni aidatlar yine property_dues'a yazılır, açık kalemler Muhasebe > Cari'de elle kalem olarak görünür.
--   cash_entries.party_id geri doldurması ve depozito hareketleri kalır (rentals.deposit_*_entry_id sütunları düşer).
set local lock_timeout = '5s';

drop trigger if exists trg_cash_entries_source_party on public.cash_entries;
drop trigger if exists trg_finance_open_items_settled_on on public.finance_open_items;

drop function if exists public.rental_deposit_unpost(uuid, text, text);
drop function if exists public.rental_deposit_post(uuid, text, uuid, date);
drop function if exists public.finance_due_cancel(uuid, text);
drop function if exists public.finance_due_reopen(uuid);
drop function if exists public.finance_due_mark_paid(uuid[], uuid, date);
drop function if exists public.finance_due_update(uuid, jsonb);
drop function if exists public.finance_due_lock(uuid, uuid);
drop function if exists public.finance_due_create(jsonb);
drop function if exists public.finance_due_backfill();
drop function if exists public.finance_open_items_settled_on();
drop function if exists public.cash_entries_source_party();
drop function if exists public.finance_source_party(uuid, text, uuid);
drop function if exists public.finance_customer_party(uuid, uuid, text);
drop function if exists public.finance_wp4_stamp_key(text, uuid, text);

drop function if exists public.aidat_kpi();
create function public.aidat_kpi()
returns table (
  total         numeric,
  unpaid        numeric,
  overdue_count bigint,
  overdue_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount), 0)                                                              as total,
    coalesce(sum(amount) filter (where status <> 'paid'), 0)                              as unpaid,
    count(*)            filter (where status <> 'paid' and due_date <= current_date)       as overdue_count,
    coalesce(sum(amount) filter (where status <> 'paid' and due_date <= current_date), 0) as overdue_total
  from public.property_dues
  where tenant_id = public.current_tenant_id();
$$;
revoke execute on function public.aidat_kpi() from public, anon;
grant execute on function public.aidat_kpi() to authenticated, service_role;

drop policy if exists owner_charge_links_insert on public.owner_charge_links;
create policy owner_charge_links_insert on public.owner_charge_links
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('rentals', 'edit'))
    and (
      (kind = 'expense' and exists (
        select 1 from public.expenses e
          join public.rentals r on r.property_id = e.property_id and r.tenant_id = e.tenant_id
         where e.id = ref_id and e.tenant_id = owner_charge_links.tenant_id and r.id = owner_charge_links.rental_id
      ))
      or (kind = 'due' and exists (
        select 1 from public.property_dues d
          join public.rentals r on r.property_id = d.property_id and r.tenant_id = d.tenant_id
         where d.id = ref_id and d.tenant_id = owner_charge_links.tenant_id and r.id = owner_charge_links.rental_id
      ))
    )
  );

grant insert, update, delete on public.property_dues to authenticated;
drop policy if exists property_dues_tenant_insert on public.property_dues;
create policy property_dues_tenant_insert on public.property_dues
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('expenses', 'create')));
drop policy if exists property_dues_tenant_update on public.property_dues;
create policy property_dues_tenant_update on public.property_dues
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')));
drop policy if exists property_dues_delete on public.property_dues;
create policy property_dues_delete on public.property_dues
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('expenses', 'delete')));
comment on table public.property_dues is null;

drop index if exists public.idx_finance_open_items_due_list;
drop index if exists public.idx_finance_open_items_due_source_unique;
alter table public.finance_open_items drop column if exists settled_on;
alter table public.rentals drop column if exists deposit_returned_entry_id;
alter table public.rentals drop column if exists deposit_received_entry_id;
alter table public.property_dues drop column if exists open_item_id;
alter table public.property_dues drop constraint if exists property_dues_direction_check;
alter table public.property_dues drop column if exists direction;
