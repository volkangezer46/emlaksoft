-- MIGRATION 20260826002960_rent_reminders.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826002960_rent_reminders.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826002960_rent_reminders.rollback.sql
-- BAGIMLILIK: public.tenants, public.rentals (+ idx_rentals_id_tenant_unique), public.customers, public.current_tenant_id().
-- On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC (H3): kiraciya kira hatirlatma. KAPALI DOGAR (enabled default false): ayar acilmadan hicbir mesaj/gorev uretilmez.
--  * rent_reminder_settings: ofis basina tek satir (acma/kapama, SMS, vade oncesi/sonrasi gun, sessiz saat).
--  * rent_reminders: hatirlatma kaydi + DEDUPE (unique rental_id, period, kind, channel): ayni kira/donem/tur/kanal tek kez.
--  * customers.rent_reminder_opt_out: kiraci vazgecme (opt-out) isareti; true ise hicbir kanalda hatirlatma uretilmez.
-- Yalniz ekler; mevcut satir/davranis degismez. Kod tablolar yokken zarifce atlar.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null
     or pg_catalog.to_regclass('public.rentals') is null
     or pg_catalog.to_regclass('public.customers') is null then
    raise exception 'tenants/rentals/customers yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
  if not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'idx_rentals_id_tenant_unique') then
    raise exception 'idx_rentals_id_tenant_unique yok; 20260809000020 once uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Kiraci vazgecme (opt-out)
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists rent_reminder_opt_out boolean not null default false;
alter table public.customers add column if not exists rent_reminder_opt_out_at timestamptz;
comment on column public.customers.rent_reminder_opt_out is
  'Kira hatirlatmasi almak istemiyor (ofis kaydeder). true iken wa.me gorevi ve SMS uretilmez.';

-- ---------------------------------------------------------------------------
-- Ofis ayari (KAPALI DOGAR)
-- ---------------------------------------------------------------------------
create table if not exists public.rent_reminder_settings (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  enabled          boolean  not null default false,
  sms_enabled      boolean  not null default false,
  days_before      smallint not null default 3  check (days_before between 0 and 10),
  late_after_days  smallint not null default 3  check (late_after_days between 1 and 30),
  quiet_start_hour smallint not null default 21 check (quiet_start_hour between 0 and 23),
  quiet_end_hour   smallint not null default 8  check (quiet_end_hour between 0 and 23),
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);

comment on table public.rent_reminder_settings is
  'Kiraci hatirlatma ofis ayari. enabled=false (varsayilan) iken kira-tahakkuk cron hicbir hatirlatma uretmez.';

-- ---------------------------------------------------------------------------
-- Hatirlatma kaydi + dedupe
-- ---------------------------------------------------------------------------
create table if not exists public.rent_reminders (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  rental_id  uuid not null,
  period     date not null check (extract(day from period) = 1),
  kind       text not null check (kind in ('before', 'due', 'late')),
  channel    text not null check (channel in ('office', 'sms')),
  status     text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  reason     text check (reason is null or char_length(reason) <= 200),
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint rent_reminders_rental_tenant_fkey
    foreign key (rental_id, tenant_id) references public.rentals(id, tenant_id) on delete cascade,
  constraint rent_reminders_once unique (rental_id, period, kind, channel)
);

create index if not exists idx_rent_reminders_tenant on public.rent_reminders (tenant_id, created_at desc);
create index if not exists idx_rent_reminders_rental on public.rent_reminders (rental_id, period desc);

comment on table public.rent_reminders is
  'Kiraci hatirlatma kaydi. unique(rental_id, period, kind, channel) ayni hatirlatmanin ikinci kez uretilmesini keser.';

-- ---------------------------------------------------------------------------
-- RLS: tenant izolasyonu. Ayari ofis kullanicisi yazar (yetki kapisi action'da); kaydi cron (service_role) yazar,
-- ofis yalniz okur ve "ofis kanali" satirini gonderildi diye isaretleyebilir (update).
-- ---------------------------------------------------------------------------
alter table public.rent_reminder_settings enable row level security;
alter table public.rent_reminders enable row level security;

drop policy if exists rent_reminder_settings_select on public.rent_reminder_settings;
create policy rent_reminder_settings_select on public.rent_reminder_settings
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists rent_reminder_settings_insert on public.rent_reminder_settings;
create policy rent_reminder_settings_insert on public.rent_reminder_settings
  for insert to authenticated with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists rent_reminder_settings_update on public.rent_reminder_settings;
create policy rent_reminder_settings_update on public.rent_reminder_settings
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists rent_reminders_select on public.rent_reminders;
create policy rent_reminders_select on public.rent_reminders
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists rent_reminders_update on public.rent_reminders;
create policy rent_reminders_update on public.rent_reminders
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and channel = 'office')
  with check (tenant_id = (select public.current_tenant_id()) and channel = 'office');

revoke all on public.rent_reminder_settings from public, anon, authenticated;
revoke all on public.rent_reminders from public, anon, authenticated;
grant select, insert, update on public.rent_reminder_settings to authenticated;
grant select, update on public.rent_reminders to authenticated;
grant all on public.rent_reminder_settings to service_role;
grant all on public.rent_reminders to service_role;
