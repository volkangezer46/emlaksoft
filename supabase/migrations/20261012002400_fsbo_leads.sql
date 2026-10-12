-- MIGRATION 20261012002400_fsbo_leads.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261012002400_fsbo_leads.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261012002400_fsbo_leads.rollback.sql
-- BAGIMLILIK: tenants, profiles, branches, geo_provinces, geo_districts, customers, properties, tasks, pg_trgm,
--   public.current_tenant_id(), public.has_effective_permission(), public.faz2_touch_updated_at().
--
-- AMAC: "Sahibinden ilanlar" (portfoy avi, modul `prospecting`): danismanin KENDI actigi portal ilanini ofis kaydina
--   eklemesi, arama/takip, fiyat gecmisi, aranmasin listesi ve portfoye donusum. Sunucu tarafi kazima YOKTUR.
-- NE: (1) fsbo_leads (ilan + sahip + takip durumu); (2) fsbo_lead_observations (fiyat gecmisi); (3) fsbo_lead_activities
--   (zaman cizelgesi, notlar); (4) fsbo_do_not_call (ofis geneli aranmasin; YALNIZ telefon ozeti, ham numara yok);
--   (5) tasks.fsbo_lead_id (musteri olusmadan "tekrar ara" gorevi).
-- GIZLILIK: TC/vergi no YOK; ilan aciklamasi/fotograf YOK (telif). Kisisel alanlar (owner_name, phone, phone_hash, activity.note)
--   saklama suresi dolunca (varsayilan 90 gun, ofis ayari 30-180) `operational-retention` cron adimi ile silinir (pii_purged_at).
--   Aranmasin: ham telefon saklanmaz, lead temizlense de kalir.
-- RLS: kiracı siniri `tenant_id = public.current_tenant_id()`; yazma `prospecting` izni (create/edit/delete). Danisman kapsami
--   (kendi + sahipsiz) sayfa/eylem katmaninda uygulanir; ofis ici tekillestirme icin kiracı genelinde okuma gerekir.
-- GRANT: authenticated + service_role ACIKCA verilir (acik grant'siz tablo service_role'de yazilamiyor).
-- RISK: dusuk (yeni tablolar + tasks'a nullable sutun).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.customers') is null or pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.tasks') is null or pg_catalog.to_regclass('public.geo_districts') is null then
    raise exception 'customers/properties/tasks/geo_districts tablolarindan biri yok.';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_trgm') then
    raise exception 'pg_trgm eklentisi yok; once create extension pg_trgm.';
  end if;
end $$;

create table if not exists public.fsbo_leads (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  branch_id            uuid        references public.branches(id) on delete set null,
  assigned_to          uuid        references public.profiles(id) on delete set null,
  created_by           uuid        references public.profiles(id) on delete set null,
  source               text        not null default 'manual' check (source in ('extension', 'manual', 'import')),
  portal               text        not null default 'other' check (portal in ('sahibinden', 'hepsiemlak', 'emlakjet', 'other')),
  external_id          text        check (external_id is null or char_length(external_id) <= 40),
  url                  text        check (url is null or (char_length(url) <= 600 and url ~ '^https?://')),
  title                text        check (title is null or char_length(title) <= 200),
  transaction_type     text        not null default 'sale' check (transaction_type in ('sale', 'rent')),
  property_type        text        check (property_type is null or char_length(property_type) <= 60),
  price                numeric     check (price is null or price >= 0),
  currency             text        not null default 'TRY',
  rooms                text        check (rooms is null or char_length(rooms) <= 20),
  gross_m2             numeric     check (gross_m2 is null or gross_m2 >= 0),
  net_m2               numeric     check (net_m2 is null or net_m2 >= 0),
  province_id          uuid        references public.geo_provinces(id) on delete set null,
  district_id          uuid        references public.geo_districts(id) on delete set null,
  location_text        text        check (location_text is null or char_length(location_text) <= 200),
  listed_at            date,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  listing_status       text        not null default 'unknown' check (listing_status in ('active', 'removed', 'unknown')),
  owner_name           text        check (owner_name is null or char_length(owner_name) <= 120),
  phone                text        check (phone is null or char_length(phone) <= 20),
  phone_hash           text        check (phone_hash is null or char_length(phone_hash) = 64),
  status               text        not null default 'yeni' check (status in ('yeni', 'arandi', 'randevu', 'yetki_alindi', 'portfoye_donustu', 'kayip')),
  status_changed_at    timestamptz not null default now(),
  lost_reason          text        check (lost_reason is null or lost_reason in ('satti', 'emlakci_istemiyor', 'baska_ofis', 'fiyat_gercekci_degil', 'ilan_kalkti', 'aslinda_emlakci', 'ulasilamadi', 'diger')),
  contact_attempts     integer     not null default 0 check (contact_attempts >= 0),
  last_contact_at      timestamptz,
  next_action_at       timestamptz,
  last_activity_at     timestamptz not null default now(),
  price_drop_count     integer     not null default 0 check (price_drop_count >= 0),
  last_price_drop_pct  numeric,
  last_price_drop_at   timestamptz,
  relist_of            uuid        references public.fsbo_leads(id) on delete set null,
  customer_id          uuid        references public.customers(id) on delete set null,
  property_id          uuid        references public.properties(id) on delete set null,
  converted_at         timestamptz,
  claim_expires_at     timestamptz,
  is_sample            boolean     not null default false,
  pii_purged_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint fsbo_leads_lost_reason_required check (status <> 'kayip' or lost_reason is not null)
);

comment on table public.fsbo_leads is 'Sahibinden ilan sahibi adaylari (portfoy avi). Kaynak: danismanin kendi actigi ilan (eklenti Kaydet / elle). Kisisel alanlar saklama suresi sonunda silinir (pii_purged_at). Sunucu portal sayfasi cekmez.';
comment on column public.fsbo_leads.phone_hash is 'sha256(fsbo-v1|tenant|saklama bicimi) hex; aranmasin ve tekrar ilan eslesmesi icin. Ham numara degildir.';

create unique index if not exists uq_fsbo_leads_portal_external
  on public.fsbo_leads (tenant_id, portal, external_id)
  where external_id is not null and deleted_at is null;
create index if not exists idx_fsbo_leads_next_action on public.fsbo_leads (tenant_id, status, next_action_at) where deleted_at is null;
create index if not exists idx_fsbo_leads_assignee on public.fsbo_leads (tenant_id, assigned_to, status) where deleted_at is null;
create index if not exists idx_fsbo_leads_phone_hash on public.fsbo_leads (tenant_id, phone_hash) where phone_hash is not null;
create index if not exists idx_fsbo_leads_district on public.fsbo_leads (tenant_id, district_id) where deleted_at is null;
create index if not exists idx_fsbo_leads_activity on public.fsbo_leads (last_activity_at) where pii_purged_at is null;
create index if not exists idx_fsbo_leads_title_trgm on public.fsbo_leads using gin (title public.gin_trgm_ops);
create index if not exists idx_fsbo_leads_external_trgm on public.fsbo_leads using gin (external_id public.gin_trgm_ops);

drop trigger if exists trg_fsbo_leads_touch on public.fsbo_leads;
create trigger trg_fsbo_leads_touch before update on public.fsbo_leads
  for each row execute function public.faz2_touch_updated_at();

create table if not exists public.fsbo_lead_observations (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  lead_id        uuid        not null references public.fsbo_leads(id) on delete cascade,
  observed_at    timestamptz not null default now(),
  price          numeric     check (price is null or price >= 0),
  currency       text        not null default 'TRY',
  listing_status text        not null default 'unknown' check (listing_status in ('active', 'removed', 'unknown')),
  source         text        not null default 'manual' check (source in ('extension', 'manual', 'recheck')),
  observed_by    uuid        references public.profiles(id) on delete set null
);

create index if not exists idx_fsbo_observations_lead on public.fsbo_lead_observations (tenant_id, lead_id, observed_at desc);

create table if not exists public.fsbo_lead_activities (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  lead_id    uuid        not null references public.fsbo_leads(id) on delete cascade,
  actor_id   uuid        references public.profiles(id) on delete set null,
  kind       text        not null check (kind in ('call', 'note', 'status', 'meeting', 'message')),
  outcome    text        check (outcome is null or outcome in ('ulasilamadi', 'mesgul', 'gorusuldu', 'ilgilenmiyor', 'sonra_ara', 'randevu', 'yetki', 'aranmasin')),
  note       text        check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

comment on table public.fsbo_lead_activities is 'Sahibinden ilan zaman cizelgesi. calls tablosuna YAZILMAZ: calls.phone kalicidir ve saklama suresiyle celisir. note alani saklama suresinde silinir.';
create index if not exists idx_fsbo_activities_lead on public.fsbo_lead_activities (tenant_id, lead_id, created_at desc);
create index if not exists idx_fsbo_activities_actor on public.fsbo_lead_activities (tenant_id, actor_id, created_at desc);

create table if not exists public.fsbo_do_not_call (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  phone_hash text        not null check (char_length(phone_hash) = 64),
  reason     text        not null default 'ilan_sahibi_istedi' check (reason in ('ilan_sahibi_istedi', 'aslinda_emlakci', 'diger')),
  created_by uuid        references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fsbo_do_not_call_unique unique (tenant_id, phone_hash)
);

comment on table public.fsbo_do_not_call is 'Ofis geneli aranmasin listesi. Ham telefon SAKLANMAZ (yalniz ozet); kayit lead temizlense de kalir. Cikarma yalniz yonetici.';

alter table public.tasks add column if not exists fsbo_lead_id uuid references public.fsbo_leads(id) on delete set null;
create index if not exists idx_tasks_fsbo_lead on public.tasks (tenant_id, fsbo_lead_id) where fsbo_lead_id is not null;

alter table public.fsbo_leads enable row level security;
alter table public.fsbo_lead_observations enable row level security;
alter table public.fsbo_lead_activities enable row level security;
alter table public.fsbo_do_not_call enable row level security;

-- fsbo_leads
drop policy if exists fsbo_leads_select on public.fsbo_leads;
create policy fsbo_leads_select on public.fsbo_leads
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'view'));
drop policy if exists fsbo_leads_insert on public.fsbo_leads;
create policy fsbo_leads_insert on public.fsbo_leads
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'create'));
drop policy if exists fsbo_leads_update on public.fsbo_leads;
create policy fsbo_leads_update on public.fsbo_leads
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'edit'))
  with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'edit'));
drop policy if exists fsbo_leads_delete on public.fsbo_leads;
create policy fsbo_leads_delete on public.fsbo_leads
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'delete'));

-- fsbo_lead_observations (yalniz ekleme; gecmis degistirilmez)
drop policy if exists fsbo_observations_select on public.fsbo_lead_observations;
create policy fsbo_observations_select on public.fsbo_lead_observations
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'view'));
drop policy if exists fsbo_observations_insert on public.fsbo_lead_observations;
create policy fsbo_observations_insert on public.fsbo_lead_observations
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_effective_permission('prospecting', 'create')
    and exists (select 1 from public.fsbo_leads l where l.id = lead_id and l.tenant_id = fsbo_lead_observations.tenant_id)
  );

-- fsbo_lead_activities (yalniz ekleme)
drop policy if exists fsbo_activities_select on public.fsbo_lead_activities;
create policy fsbo_activities_select on public.fsbo_lead_activities
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'view'));
drop policy if exists fsbo_activities_insert on public.fsbo_lead_activities;
create policy fsbo_activities_insert on public.fsbo_lead_activities
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_effective_permission('prospecting', 'edit')
    and exists (select 1 from public.fsbo_leads l where l.id = lead_id and l.tenant_id = fsbo_lead_activities.tenant_id)
  );

-- fsbo_do_not_call
drop policy if exists fsbo_dnc_select on public.fsbo_do_not_call;
create policy fsbo_dnc_select on public.fsbo_do_not_call
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'view'));
drop policy if exists fsbo_dnc_insert on public.fsbo_do_not_call;
create policy fsbo_dnc_insert on public.fsbo_do_not_call
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'edit'));
drop policy if exists fsbo_dnc_delete on public.fsbo_do_not_call;
create policy fsbo_dnc_delete on public.fsbo_do_not_call
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'delete'));

grant select, insert, update, delete on public.fsbo_leads to authenticated;
grant select, insert on public.fsbo_lead_observations to authenticated;
grant select, insert on public.fsbo_lead_activities to authenticated;
grant select, insert, delete on public.fsbo_do_not_call to authenticated;
-- service_role: saklama suresi temizligi (operational-retention) lead + etkinlik gunceller; digerleri okuma/yazma.
grant select, insert, update, delete on public.fsbo_leads to service_role;
grant select, insert, update, delete on public.fsbo_lead_observations to service_role;
grant select, insert, update, delete on public.fsbo_lead_activities to service_role;
grant select, insert, update, delete on public.fsbo_do_not_call to service_role;

notify pgrst, 'reload schema';
