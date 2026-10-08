-- Rollback: 20261008001700_building_management
-- Bina, daire, tahakkuk ve tahsilat tabloları ile fonksiyonlar düşer; bina aidatı tahsilatları ve ortak gider paylaştırmaları KAYBOLUR
-- (önce Rapor merkezinden dışa aktarın). owner_charge_links 'unit_charge' (mahsup) satırları silinir, kısıt/politika eski haline döner.
-- Tekil mülk aidatları (property_dues) ve kira tahsilatları ETKİLENMEZ. Makbuz sayacı (rent_receipt_counters) geri sarılmaz.

set local lock_timeout = '5s';

drop function if exists public.building_dues_kpi(date);
drop function if exists public.void_building_payment(uuid, text);
drop function if exists public.offset_building_charge_to_owner(uuid, numeric);
drop function if exists public.record_building_payment(uuid, numeric, date, text, text);
drop function if exists public.void_building_batch(uuid, text);
drop function if exists public.create_building_batch(uuid, text, date, text, text, numeric, text, date, jsonb);
drop function if exists public.bm_insert_payment(uuid, uuid, public.building_charges, numeric, date, text, text);
drop function if exists public.bm_recompute_charge(uuid);

drop table if exists public.building_payments;
drop table if exists public.building_charges;
drop table if exists public.building_charge_batches;
drop table if exists public.building_units;
drop table if exists public.buildings;

delete from public.owner_charge_links where kind = 'unit_charge';

do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.owner_charge_links'::regclass
       and con.contype = 'c'
       and pg_catalog.pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute pg_catalog.format('alter table public.owner_charge_links drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.owner_charge_links
  add constraint owner_charge_links_kind_check check (kind in ('expense', 'due'));

drop policy if exists owner_charge_links_delete on public.owner_charge_links;
create policy owner_charge_links_delete on public.owner_charge_links
  for delete to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));

notify pgrst, 'reload schema';
