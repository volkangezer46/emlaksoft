-- F1: Yasal kayit defteri (islem kayit defteri). TASLAK: canli DB'ye uygulanmadi.
-- Forward-only, yeniden calistirilabilir. Hukuki iddia icermez: esikler ve saklama suresi OFIS AYARIDIR.
-- Degistirilemez kayit: yalniz INSERT. Duzeltme = kind 'correction' + corrects_entry_id ile YENI kayit.
-- TC kimlik no / kimlik fotokopisi SAKLANMAZ; yalniz "kimlik goruldu" bayragi tutulur.
-- Gorunurluk: owner/gm tum ofis kayitlarini, diger roller yalniz kendi olusturduklarini gorur.

create table if not exists public.compliance_ledger_settings (
  tenant_id                 uuid primary key references public.tenants(id) on delete cascade,
  cash_threshold_try        numeric(14,2) not null default 100000 check (cash_threshold_try >= 0),
  amount_threshold_try      numeric(14,2) not null default 1000000 check (amount_threshold_try >= 0),
  retention_years           int not null default 5 check (retention_years between 1 and 30),
  updated_by                uuid references public.profiles(id) on delete set null,
  updated_at                timestamptz not null default now()
);

create table if not exists public.compliance_ledger_entries (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  kind               text not null default 'entry' check (kind in ('entry','correction')),
  corrects_entry_id  uuid,
  transaction_type   text not null
    check (transaction_type in ('sale','rental','deposit','commission','service_fee','other')),
  transaction_date   date not null,
  party_name         text not null check (char_length(party_name) between 1 and 160),
  party_role         text not null check (party_role in ('buyer','seller','tenant','landlord','other')),
  counterparty_name  text check (counterparty_name is null or char_length(counterparty_name) <= 160),
  identity_checked   boolean not null default false,
  amount_try         numeric(14,2) not null check (amount_try >= 0),
  payment_method     text not null check (payment_method in ('bank_transfer','cash','card','cheque','other')),
  flags              text[] not null default '{}',
  threshold_snapshot jsonb,
  note               text check (note is null or char_length(note) <= 1000),
  -- Baglar gevsek tutulur (FK yok): degistirilemez kayit, bagli satirin silinmesinden etkilenmesin.
  customer_id        uuid,
  property_id        uuid,
  deal_id            uuid,
  retain_until       date not null,
  is_sample          boolean not null default false,
  created_by         uuid not null default auth.uid(),
  created_at         timestamptz not null default now(),
  constraint compliance_ledger_correction_ref
    check ((kind = 'correction') = (corrects_entry_id is not null))
);

create index if not exists idx_compliance_ledger_tenant_date
  on public.compliance_ledger_entries (tenant_id, transaction_date desc);
create index if not exists idx_compliance_ledger_tenant_creator
  on public.compliance_ledger_entries (tenant_id, created_by, created_at desc);
create index if not exists idx_compliance_ledger_flagged
  on public.compliance_ledger_entries (tenant_id, transaction_date desc)
  where cardinality(flags) > 0;

-- Degistirilemezlik: UPDATE her zaman, DELETE dogrudan reddedilir. Ofis hesabi silinirken
-- (tenants ON DELETE CASCADE) tetik derinligi > 1 oldugu icin silme gecer.
create or replace function public.compliance_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'compliance_ledger_entries degistirilemez: duzeltme icin yeni kayit ekleyin'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists compliance_ledger_no_update on public.compliance_ledger_entries;
create trigger compliance_ledger_no_update
  before update or delete on public.compliance_ledger_entries
  for each row execute function public.compliance_ledger_immutable();

alter table public.compliance_ledger_settings enable row level security;
alter table public.compliance_ledger_entries enable row level security;

drop policy if exists compliance_ledger_settings_select on public.compliance_ledger_settings;
create policy compliance_ledger_settings_select on public.compliance_ledger_settings
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists compliance_ledger_settings_write on public.compliance_ledger_settings;
create policy compliance_ledger_settings_write on public.compliance_ledger_settings
  for all using (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner','gm'))
  with check (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner','gm'));

drop policy if exists compliance_ledger_entries_select on public.compliance_ledger_entries;
create policy compliance_ledger_entries_select on public.compliance_ledger_entries
  for select using (
    tenant_id = public.current_tenant_id()
    and (public.current_profile_role() in ('owner','gm') or created_by = auth.uid())
  );

drop policy if exists compliance_ledger_entries_insert on public.compliance_ledger_entries;
create policy compliance_ledger_entries_insert on public.compliance_ledger_entries
  for insert with check (tenant_id = public.current_tenant_id() and created_by = auth.uid());

drop policy if exists compliance_ledger_entries_staff on public.compliance_ledger_entries;
create policy compliance_ledger_entries_staff on public.compliance_ledger_entries
  for select using (public.is_platform_staff());

drop policy if exists compliance_ledger_settings_staff on public.compliance_ledger_settings;
create policy compliance_ledger_settings_staff on public.compliance_ledger_settings
  for select using (public.is_platform_staff());

grant select, insert on public.compliance_ledger_entries to authenticated;
grant select, insert, update on public.compliance_ledger_settings to authenticated;

notify pgrst, 'reload schema';
