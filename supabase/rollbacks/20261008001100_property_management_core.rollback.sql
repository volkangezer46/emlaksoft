-- Rollback: 20261008001100_property_management_core
-- Yeni tablolar ve fonksiyonlar düşer. Tahsilat kayıtları (rent_payments), mülk sahibi ödemeleri (owner_payouts),
-- yönetim sözleşmeleri ve hakedişe yansıtılan gider bağlantıları KAYBOLUR (önce dışa aktarın).
-- rent_charges eski sınırına döner: 'partial' tahakkuklar 'pending'e çekilir, paid_amount sütunu düşer; 'paid' olanlar paid KALIR.
-- Kod tablolar yokken tahsilat kaydı / mülk sahibi sekmelerini "etkin değil" der; eski "ödendi işaretle" akışı sürer.

set local lock_timeout = '5s';

drop function if exists public.void_owner_payout(uuid, text);
drop function if exists public.record_owner_payout(uuid, numeric, date, text, text, text);
drop function if exists public.void_rent_payment(uuid, text);
drop function if exists public.record_rent_payment(uuid, numeric, date, text, text);
drop function if exists public.pm_recompute_charge(uuid);
drop function if exists public.pm_charge_due_date(date, integer);

drop table if exists public.property_management_settings;
drop table if exists public.owner_charge_links;
drop table if exists public.owner_payouts;
drop table if exists public.rental_management_agreements;
drop table if exists public.rent_payments;
drop table if exists public.rent_receipt_counters;

drop index if exists public.idx_rent_charges_id_tenant_unique;

-- rent_reminders.kind: 'owner_payout' satırları silinir, kısıt eski değerlere döner (tablo yoksa atlanır).
do $$
declare
  c record;
begin
  if pg_catalog.to_regclass('public.rent_reminders') is not null then
    delete from public.rent_reminders where kind = 'owner_payout';
    for c in
      select con.conname
        from pg_catalog.pg_constraint con
       where con.conrelid = 'public.rent_reminders'::regclass
         and con.contype = 'c'
         and pg_catalog.pg_get_constraintdef(con.oid) ilike '%kind%'
    loop
      execute pg_catalog.format('alter table public.rent_reminders drop constraint %I', c.conname);
    end loop;
    alter table public.rent_reminders
      add constraint rent_reminders_kind_check check (kind in ('before', 'due', 'late'));
  end if;
end $$;

update public.rent_charges set status = 'pending' where status = 'partial';

do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.rent_charges'::regclass
       and con.contype = 'c'
       and pg_catalog.pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute pg_catalog.format('alter table public.rent_charges drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.rent_charges
  add constraint rent_charges_status_check check (status in ('pending', 'paid', 'overdue'));

alter table public.rent_charges drop column if exists paid_amount;

notify pgrst, 'reload schema';
