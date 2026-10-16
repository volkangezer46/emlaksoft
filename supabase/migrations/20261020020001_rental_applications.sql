-- SP5: Kiracı başvurusu (portföye bağlı başvuru bağlantısı, aday + kefil bilgisi, evrak, malik onayı) ve kira kaydında kefil.
--
-- Akış:
--   * Ofis kiralık portföy için başvuru bağlantısı açar (rental_application_links; token düz saklanır çünkü bağlantı ilanda/
--     WhatsApp'ta herkese paylaşılmak içindir, kişiye özel sır değildir; kapatılınca 404).
--   * Aday /kiraci-basvuru/<token> formunu KVKK onayıyla doldurur (yalnız service_role yazar; anon/authenticated INSERT YOK).
--     Gönderimden sonra kısa süreli yükleme anahtarıyla (upload_key_hash, 2 saat) evrak yükler (rental_application_files).
--   * Ofis adayları yan yana karşılaştırır, kısa listeye alır, malike önerir (owner_review). Malik portalında onay/ret verir
--     (service_role; token portföye sabit). Onaylanan aday müşteriye dönüştürülür, kira kaydı açılınca kefil bilgisi
--     rentals.guarantor_* sütunlarına taşınır.
--   * KVKK saklama: retain_until (varsayılan 180 gün; onaylanan aday 2 yıl). Süresi dolan başvurular cron adımıyla
--     (rental_applications_purge_expired) dosyalarıyla birlikte silinir.
-- Okuma: rentals:view; yazma (durum/not): rentals:edit. Silme yalnız service_role (saklama süresi).

-- ---------------------------------------------------------------------------
-- 1) Kira kaydında kefil
-- ---------------------------------------------------------------------------
alter table public.rentals add column if not exists guarantor_name text;
alter table public.rentals add column if not exists guarantor_phone text;
alter table public.rentals add column if not exists guarantor_address text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rentals_guarantor_len_chk' and conrelid = 'public.rentals'::regclass) then
    alter table public.rentals add constraint rentals_guarantor_len_chk check (
      (guarantor_name is null or char_length(guarantor_name) between 1 and 160)
      and (guarantor_phone is null or guarantor_phone ~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$')
      and (guarantor_address is null or char_length(guarantor_address) <= 500)
    );
  end if;
end $$;

-- Ofis kullanıcısı (rentals:edit, RLS identity_rentals_update) yalnız kefil sütunlarını doğrudan güncelleyebilir;
-- rentals'ın geri kalanı 20260813000000'den beri yalnız RPC/service_role ile yazılır (değişmedi).
grant update (guarantor_name, guarantor_phone, guarantor_address) on public.rentals to authenticated;

comment on column public.rentals.guarantor_name is 'Kefil adı soyadı (SP5; kira sözleşmesi {kefil} alanı). Kefalet ıslak imzalı ayrı belgeyle de alınmalıdır.';

-- ---------------------------------------------------------------------------
-- 2) Başvuru bağlantısı (portföy başına tek aktif)
-- ---------------------------------------------------------------------------
create table if not exists public.rental_application_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  token text not null,
  status text not null default 'active',
  asking_rent numeric(14,2),
  expires_at timestamptz not null default (now() + interval '60 days'),
  application_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  is_sample boolean not null default false,
  constraint rental_application_links_token_chk check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  constraint rental_application_links_status_chk check (status in ('active', 'closed')),
  constraint rental_application_links_rent_chk check (asking_rent is null or (asking_rent > 0 and asking_rent < 100000000))
);

create unique index if not exists rental_application_links_token_key on public.rental_application_links (token);
create unique index if not exists rental_application_links_one_active
  on public.rental_application_links (tenant_id, property_id) where status = 'active';
create index if not exists rental_application_links_tenant_idx on public.rental_application_links (tenant_id, created_at desc);
create index if not exists rental_application_links_property_idx on public.rental_application_links (property_id);

-- ---------------------------------------------------------------------------
-- 3) Başvuru
-- ---------------------------------------------------------------------------
create table if not exists public.rental_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  link_id uuid references public.rental_application_links(id) on delete set null,
  property_id uuid not null references public.properties(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  rental_id uuid references public.rentals(id) on delete set null,
  full_name text not null,
  phone text not null,
  email text,
  occupation text,
  employer text,
  monthly_income numeric(14,2),
  household_size smallint,
  has_pets boolean not null default false,
  pets_note text,
  smoker boolean not null default false,
  move_in_date date,
  message text,
  guarantor_name text,
  guarantor_phone text,
  guarantor_relation text,
  guarantor_occupation text,
  guarantor_income numeric(14,2),
  guarantor_address text,
  kvkk_consent_at timestamptz not null,
  kvkk_notice_version text not null default 'platform-v1',
  status text not null default 'new',
  status_changed_at timestamptz not null default now(),
  office_note text,
  owner_decision text,
  owner_note text,
  owner_decided_at timestamptz,
  file_count integer not null default 0,
  upload_key_hash text,
  upload_key_expires_at timestamptz,
  retain_until timestamptz not null default (now() + interval '180 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_sample boolean not null default false,
  constraint rental_applications_status_chk check (status in ('new', 'shortlisted', 'owner_review', 'approved', 'rejected', 'withdrawn')),
  constraint rental_applications_owner_decision_chk check (owner_decision is null or owner_decision in ('approved', 'rejected')),
  constraint rental_applications_name_chk check (char_length(btrim(full_name)) between 2 and 160),
  constraint rental_applications_phone_chk check (phone ~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$'),
  constraint rental_applications_guarantor_phone_chk check (guarantor_phone is null or guarantor_phone ~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$'),
  constraint rental_applications_email_chk check (email is null or char_length(email) <= 254),
  constraint rental_applications_income_chk check (
    (monthly_income is null or (monthly_income >= 0 and monthly_income < 100000000))
    and (guarantor_income is null or (guarantor_income >= 0 and guarantor_income < 100000000))
  ),
  constraint rental_applications_household_chk check (household_size is null or household_size between 1 and 20),
  constraint rental_applications_text_len_chk check (
    char_length(coalesce(occupation, '')) <= 120 and char_length(coalesce(employer, '')) <= 160
    and char_length(coalesce(pets_note, '')) <= 200 and char_length(coalesce(message, '')) <= 1000
    and char_length(coalesce(guarantor_name, '')) <= 160 and char_length(coalesce(guarantor_relation, '')) <= 80
    and char_length(coalesce(guarantor_occupation, '')) <= 120 and char_length(coalesce(guarantor_address, '')) <= 500
    and char_length(coalesce(office_note, '')) <= 2000 and char_length(coalesce(owner_note, '')) <= 500
  ),
  constraint rental_applications_file_count_chk check (file_count between 0 and 30)
);

create index if not exists rental_applications_tenant_idx on public.rental_applications (tenant_id, created_at desc);
create index if not exists rental_applications_property_idx on public.rental_applications (property_id, status);
create index if not exists rental_applications_link_idx on public.rental_applications (link_id);
create index if not exists rental_applications_customer_idx on public.rental_applications (customer_id) where customer_id is not null;
create index if not exists rental_applications_rental_idx on public.rental_applications (rental_id) where rental_id is not null;
create index if not exists rental_applications_retain_idx on public.rental_applications (retain_until);
-- Aynı bağlantıya aynı telefondan ikinci başvuru açılmaz (mükerrer/spam).
create unique index if not exists rental_applications_link_phone_key
  on public.rental_applications (link_id, phone) where link_id is not null;

comment on table public.rental_applications is 'SP5 kiracı başvurusu: aday + kefil bilgisi, KVKK onay zamanı, durum, malik kararı. Yazma: durum/not rentals:edit; aday verisi yalnız service_role (public form).';

-- ---------------------------------------------------------------------------
-- 4) Başvuru evrakı (özel kova customer-files; yol <ofis>/<başvuru>/<dosya>.<uzantı>)
-- ---------------------------------------------------------------------------
create table if not exists public.rental_application_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  application_id uuid not null references public.rental_applications(id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  file_name text not null,
  file_size bigint not null,
  mime_type text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint rental_application_files_type_chk check (doc_type in ('kimlik', 'gelir', 'calisma', 'kefil_kimlik', 'kefil_gelir', 'diger')),
  constraint rental_application_files_status_chk check (status in ('pending', 'verified', 'blocked')),
  constraint rental_application_files_size_chk check (file_size > 0 and file_size <= 10485760)
);

create unique index if not exists rental_application_files_path_key on public.rental_application_files (storage_path);
create index if not exists rental_application_files_app_idx on public.rental_application_files (application_id, status);
create index if not exists rental_application_files_pending_idx on public.rental_application_files (created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
alter table public.rental_application_links enable row level security;
alter table public.rental_applications enable row level security;
alter table public.rental_application_files enable row level security;

drop policy if exists rental_app_links_select on public.rental_application_links;
create policy rental_app_links_select on public.rental_application_links
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));
drop policy if exists rental_app_links_insert on public.rental_application_links;
create policy rental_app_links_insert on public.rental_application_links
  for insert to authenticated
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));
drop policy if exists rental_app_links_update on public.rental_application_links;
create policy rental_app_links_update on public.rental_application_links
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')))
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));

drop policy if exists rental_applications_select on public.rental_applications;
create policy rental_applications_select on public.rental_applications
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));
drop policy if exists rental_applications_update on public.rental_applications;
create policy rental_applications_update on public.rental_applications
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')))
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));

drop policy if exists rental_application_files_select on public.rental_application_files;
create policy rental_application_files_select on public.rental_application_files
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));

-- Ofis kullanıcısı aday verisini (ad, telefon, gelir, kefil, KVKK zamanı) değiştiremez; yalnız durum/not/bağ sütunları.
revoke all on public.rental_application_links from public, anon, authenticated;
revoke all on public.rental_applications from public, anon, authenticated;
revoke all on public.rental_application_files from public, anon, authenticated;
grant select, insert on public.rental_application_links to authenticated;
grant update (status, closed_at, asking_rent, expires_at) on public.rental_application_links to authenticated;
grant select on public.rental_applications to authenticated;
grant update (status, status_changed_at, office_note, customer_id, rental_id, retain_until, updated_at) on public.rental_applications to authenticated;
grant select on public.rental_application_files to authenticated;
grant all on public.rental_application_links to service_role;
grant all on public.rental_applications to service_role;
grant all on public.rental_application_files to service_role;

-- ---------------------------------------------------------------------------
-- 6) Durum geçiş kapısı (ofis kullanıcısı): kapalı başvuru yeniden açılmaz, malik kararı yalnız service_role yazar.
-- ---------------------------------------------------------------------------
create or replace function public.rental_applications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    new.updated_at := now();
    return new;
  end if;
  if new.status is distinct from old.status then
    if old.status in ('approved', 'withdrawn') then
      raise exception 'RA:closed' using errcode = 'P0001';
    end if;
    new.status_changed_at := now();
    -- Onaylanan aday (müşteri/kira kaydına dönüşebilir) 2 yıl saklanır; diğerleri başvurudan 180 gün.
    if new.status = 'approved' then
      new.retain_until := greatest(old.retain_until, now() + interval '2 years');
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rental_applications_guard_trg on public.rental_applications;
create trigger rental_applications_guard_trg
  before update on public.rental_applications
  for each row execute function public.rental_applications_guard();

revoke all on function public.rental_applications_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) KVKK saklama: süresi dolan başvuruları siler (dosya yolları silme kuyruğu için döner). Yalnız service_role (cron).
-- ---------------------------------------------------------------------------
create or replace function public.rental_applications_purge_expired(p_limit integer default 200)
returns table (tenant_id uuid, application_id uuid, storage_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(a.id), '{}') into v_ids
    from (
      select ra.id from public.rental_applications ra
       where ra.retain_until < now()
       order by ra.retain_until
       limit greatest(1, least(coalesce(p_limit, 200), 1000))
    ) a;
  if cardinality(v_ids) = 0 then
    return;
  end if;
  return query
    select f.tenant_id, f.application_id, f.storage_path
      from public.rental_application_files f
     where f.application_id = any(v_ids);
  delete from public.rental_applications ra where ra.id = any(v_ids);
end;
$$;

revoke all on function public.rental_applications_purge_expired(integer) from public, anon, authenticated;
grant execute on function public.rental_applications_purge_expired(integer) to service_role;

comment on function public.rental_applications_purge_expired(integer) is 'SP5 KVKK saklama: retain_until geçmiş başvuruları siler, dosya yollarını (silme kuyruğu) döner. Yalnız service_role.';
