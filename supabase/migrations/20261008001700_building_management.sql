-- Bina & site yönetimi (M2): bina/daire modeli + dönemlik toplu aidat tahakkuku + ortak gider paylaştırma + tahsilat + daire cari.
--
-- NEDEN: Bazı ofisler bir apartmanı/siteyi komple yönetiyor: aidatı topluyor, mülk sahibine ödeme yapıyor ve yönetim ücretinden gelir
--   elde ediyor. Mevcut property_dues tekil mülk aidatı içindi (bina, daire, dağıtım, kısmi tahsilat, cari yok).
-- İÇERİK:
--   1) buildings: bina/site (il/ilçe kimliği geo_* tablolarından; city/district görünen ad kopyasıdır; yönetici ofis mi,
--      yönetim ücreti % / sabit TL, vade günü, varsayılan dağıtım).
--   2) building_units: daire (blok, kat, no, m², arsa payı, sabit tutar, malik/kiracı müşteri, bağlı kira/portföy, ödeyen: malik|kiracı).
--   3) building_charge_batches + building_charges: dönem (ay) tahakkuku (kind=aidat) ya da ortak gider paylaştırma (kind=expense_share).
--      Paylar istemcide SAF fonksiyonla (src/lib/building-management/distribution.ts) hesaplanır; RPC toplamı ve daire kümesini DOĞRULAR.
--   4) building_payments: tahsilat (kısmi ödeme, yöntem, makbuz no). Makbuz sırası kira ile AYNI ofis sayacından (rent_receipt_counters) gelir.
--      Yönetim ücreti tahsilat anında kaydedilir (ofis geliri; kâr-zarar bu toplamı okur). Yazma YALNIZ RPC ile.
--   5) owner_charge_links.kind'a 'unit_charge': malikin aidat borcu kira hakedişinden mahsup (offset_building_charge_to_owner).
--      Mahsup tahsilatı method='owner_offset' olarak kaydedilir; bağlantı satırı yalnız RPC ile yazılır/silinir.
--   6) building_dues_kpi(): bu ay tahakkuk / tahsil / geciken / toplam borç (RLS'li, security invoker).
-- Gecikme "vade geçti" olarak OKUMA anında türetilir (saklanmaz): status yalnız pending|partial|paid.
-- Gecikme bedeli ofis ayarı property_management_settings (varsayılan KAPALI) ile hesaplanır; burada yeni ayar YOK.
-- RLS: tüm okumalar has_effective_permission('expenses','view') (Aidat sayfasının modülü); yazma create/edit/delete ile.
-- Bağımlılıklar: 20261008001100 (rent_receipt_counters, owner_charge_links), customers/properties/rentals kiracı-kimlik indeksleri.
-- GERİ ALMA: rollbacks/20261008001700_building_management.rollback.sql (yeni tablolar/fonksiyonlar düşer; 'unit_charge' bağlantıları silinir).
-- RİSK: düşük-orta (yeni tablolar; owner_charge_links kind CHECK genişler ve silme politikası daralır). Kod tablolar yokken sekmeyi gizler.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.geo_provinces') is null
     or pg_catalog.to_regclass('public.geo_districts') is null
     or pg_catalog.to_regclass('public.rentals') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regclass('public.rent_receipt_counters') is null
     or pg_catalog.to_regclass('public.owner_charge_links') is null
     or pg_catalog.to_regclass('public.rental_management_agreements') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null then
    raise exception '20261008001700: 20261008001100 (mulk yonetimi omurgasi) veya yetki yardimcilari yok.';
  end if;
  if not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'idx_customers_id_tenant_unique')
     or not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'idx_properties_id_tenant_unique')
     or not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'idx_rentals_id_tenant_unique') then
    raise exception '20261008001700: customers/properties/rentals (id, tenant_id) benzersiz indeksleri yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Bina / site
-- ---------------------------------------------------------------------------
create table if not exists public.buildings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 120),
  address              text check (address is null or char_length(address) <= 300),
  province_id          uuid references public.geo_provinces(id) on delete set null,
  district_id          uuid references public.geo_districts(id) on delete set null,
  city                 text check (city is null or char_length(city) <= 80),
  district             text check (district is null or char_length(district) <= 80),
  managed_by_office    boolean not null default true,
  fee_type             text check (fee_type is null or fee_type in ('percent', 'fixed')),
  fee_value            numeric(12,2),
  due_day              smallint not null default 5 check (due_day between 1 and 28),
  default_distribution text not null default 'equal' check (default_distribution in ('equal', 'land_share', 'area', 'fixed')),
  notes                text check (notes is null or char_length(notes) <= 1000),
  archived_at          timestamptz,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint buildings_fee_consistent check (
    (fee_type is null and fee_value is null)
    or (fee_type = 'percent' and fee_value is not null and fee_value between 0 and 100)
    or (fee_type = 'fixed' and fee_value is not null and fee_value between 0 and 1000000000)
  )
);

create unique index if not exists idx_buildings_id_tenant_unique on public.buildings (id, tenant_id);
create unique index if not exists idx_buildings_tenant_name_unique on public.buildings (tenant_id, lower(name)) where archived_at is null;
create index if not exists idx_buildings_tenant on public.buildings (tenant_id, created_at desc);

comment on table public.buildings is 'Bina/site yönetimi. fee_type: percent = tahsilatın yüzdesi; fixed = daire başına aylık sabit TL (tahakkuk başına, tahsilat tutarını aşmaz). Ücret yalnız managed_by_office=true iken alınır.';

-- ---------------------------------------------------------------------------
-- 2) Daire
-- ---------------------------------------------------------------------------
create table if not exists public.building_units (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  building_id        uuid not null,
  block              text check (block is null or char_length(block) <= 20),
  floor              smallint check (floor is null or floor between -10 and 200),
  unit_no            text not null check (char_length(unit_no) between 1 and 20),
  area_m2            numeric(8,2) check (area_m2 is null or (area_m2 > 0 and area_m2 <= 100000)),
  land_share         numeric(12,4) check (land_share is null or (land_share >= 0 and land_share <= 1000000)),
  fixed_amount       numeric(14,2) check (fixed_amount is null or (fixed_amount >= 0 and fixed_amount <= 1000000000)),
  owner_customer_id  uuid,
  tenant_customer_id uuid,
  rental_id          uuid,
  property_id        uuid,
  payer              text not null default 'owner' check (payer in ('owner', 'tenant')),
  active             boolean not null default true,
  notes              text check (notes is null or char_length(notes) <= 500),
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint building_units_building_tenant_fkey foreign key (building_id, tenant_id)
    references public.buildings(id, tenant_id) on delete cascade,
  constraint building_units_owner_customer_fkey foreign key (owner_customer_id, tenant_id)
    references public.customers(id, tenant_id) on delete set null (owner_customer_id),
  constraint building_units_tenant_customer_fkey foreign key (tenant_customer_id, tenant_id)
    references public.customers(id, tenant_id) on delete set null (tenant_customer_id),
  constraint building_units_rental_fkey foreign key (rental_id, tenant_id)
    references public.rentals(id, tenant_id) on delete set null (rental_id),
  constraint building_units_property_fkey foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete set null (property_id)
);

create unique index if not exists idx_building_units_id_tenant_unique on public.building_units (id, tenant_id);
create unique index if not exists idx_building_units_label_unique on public.building_units (building_id, coalesce(block, ''), unit_no);
create index if not exists idx_building_units_building on public.building_units (tenant_id, building_id) where active;
create index if not exists idx_building_units_owner on public.building_units (tenant_id, owner_customer_id) where owner_customer_id is not null;
create index if not exists idx_building_units_tenant_cust on public.building_units (tenant_id, tenant_customer_id) where tenant_customer_id is not null;
create index if not exists idx_building_units_property on public.building_units (tenant_id, property_id) where property_id is not null;
create index if not exists idx_building_units_rental on public.building_units (tenant_id, rental_id) where rental_id is not null;

comment on table public.building_units is 'Bina dairesi. payer: aidatı ödeyen taraf (malik|kiracı); tahakkuk anında payer_customer_id olarak kopyalanır.';

-- ---------------------------------------------------------------------------
-- 3) Tahakkuk grubu (dönem aidatı / ortak gider paylaştırma) + daire tahakkukları
-- ---------------------------------------------------------------------------
create table if not exists public.building_charge_batches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  building_id  uuid not null,
  kind         text not null check (kind in ('aidat', 'expense_share')),
  period       date not null check (extract(day from period) = 1),
  title        text not null check (char_length(title) between 1 and 160),
  category     text check (category is null or char_length(category) <= 60),
  total_amount numeric(14,2) not null check (total_amount > 0 and total_amount <= 1000000000),
  distribution text not null check (distribution in ('equal', 'land_share', 'area', 'fixed')),
  due_date     date not null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references public.profiles(id) on delete set null,
  void_reason  text check (void_reason is null or char_length(void_reason) between 3 and 300),
  constraint building_batches_building_tenant_fkey foreign key (building_id, tenant_id)
    references public.buildings(id, tenant_id) on delete cascade,
  constraint building_batches_void_consistent check ((voided_at is null) = (void_reason is null))
);

create unique index if not exists idx_building_batches_id_tenant_unique on public.building_charge_batches (id, tenant_id);
-- Bir binada bir dönem için tek (iptal edilmemiş) aidat tahakkuku.
create unique index if not exists idx_building_batches_aidat_period on public.building_charge_batches (building_id, period)
  where kind = 'aidat' and voided_at is null;
create index if not exists idx_building_batches_building on public.building_charge_batches (tenant_id, building_id, period desc);

comment on table public.building_charge_batches is 'Toplu tahakkuk: kind=aidat (dönem başına tek) | expense_share (bina gideri paylaştırma). Silinmez; iptal = voided_at + neden (ödeme varken iptal edilemez). Yazma yalnız RPC.';

create table if not exists public.building_charges (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  batch_id          uuid not null,
  building_id       uuid not null,
  unit_id           uuid not null,
  amount            numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  paid_amount       numeric(14,2) not null default 0 check (paid_amount >= 0),
  status            text not null default 'pending' check (status in ('pending', 'partial', 'paid')),
  due_date          date not null,
  payer_role        text not null check (payer_role in ('owner', 'tenant')),
  payer_customer_id uuid,
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  constraint building_charges_batch_tenant_fkey foreign key (batch_id, tenant_id)
    references public.building_charge_batches(id, tenant_id) on delete cascade,
  constraint building_charges_unit_tenant_fkey foreign key (unit_id, tenant_id)
    references public.building_units(id, tenant_id) on delete cascade,
  constraint building_charges_building_tenant_fkey foreign key (building_id, tenant_id)
    references public.buildings(id, tenant_id) on delete cascade,
  constraint building_charges_payer_customer_fkey foreign key (payer_customer_id, tenant_id)
    references public.customers(id, tenant_id) on delete set null (payer_customer_id),
  constraint building_charges_batch_unit_unique unique (batch_id, unit_id)
);

create unique index if not exists idx_building_charges_id_tenant_unique on public.building_charges (id, tenant_id);
create index if not exists idx_building_charges_unit on public.building_charges (tenant_id, unit_id, due_date desc);
create index if not exists idx_building_charges_open on public.building_charges (tenant_id, due_date) where status <> 'paid' and voided_at is null;
create index if not exists idx_building_charges_building on public.building_charges (tenant_id, building_id, due_date desc);
create index if not exists idx_building_charges_payer on public.building_charges (tenant_id, payer_customer_id) where payer_customer_id is not null;

comment on column public.building_charges.status is 'pending | partial | paid — ödenen toplamdan RPC türetir. "Gecikti" saklanmaz: status<>paid ve due_date < bugün (TR) okuma anında türetilir.';

-- ---------------------------------------------------------------------------
-- 4) Tahsilat
-- ---------------------------------------------------------------------------
create table if not exists public.building_payments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  charge_id      uuid not null,
  unit_id        uuid not null,
  building_id    uuid not null,
  amount         numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  paid_on        date not null,
  method         text not null check (method in ('cash', 'bank_transfer', 'card', 'cheque', 'owner_offset')),
  bank_note      text check (bank_note is null or char_length(bank_note) <= 300),
  receipt_no     integer not null check (receipt_no > 0),
  management_fee numeric(14,2) not null default 0 check (management_fee >= 0),
  fee_type       text check (fee_type is null or fee_type in ('percent', 'fixed')),
  fee_value      numeric(12,2) check (fee_value is null or fee_value >= 0),
  recorded_by    uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.profiles(id) on delete set null,
  void_reason    text check (void_reason is null or char_length(void_reason) between 3 and 300),
  constraint building_payments_charge_tenant_fkey foreign key (charge_id, tenant_id)
    references public.building_charges(id, tenant_id) on delete cascade,
  constraint building_payments_unit_tenant_fkey foreign key (unit_id, tenant_id)
    references public.building_units(id, tenant_id) on delete cascade,
  constraint building_payments_building_tenant_fkey foreign key (building_id, tenant_id)
    references public.buildings(id, tenant_id) on delete cascade,
  constraint building_payments_receipt_unique unique (tenant_id, receipt_no),
  constraint building_payments_void_consistent check ((voided_at is null) = (void_reason is null))
);

create index if not exists idx_building_payments_charge on public.building_payments (charge_id, created_at);
create index if not exists idx_building_payments_unit on public.building_payments (tenant_id, unit_id, paid_on desc);
create index if not exists idx_building_payments_tenant_paid on public.building_payments (tenant_id, paid_on desc) where voided_at is null;

comment on table public.building_payments is 'Aidat/gider tahsilatı. Silinmez; iptal = voided_at + neden. Makbuz no kira ile aynı ofis sayacından. management_fee ofis geliridir (kâr-zarar).';

-- ---------------------------------------------------------------------------
-- 5) owner_charge_links: 'unit_charge' (malik aidat borcunun hakedişten mahsubu)
-- ---------------------------------------------------------------------------
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
  add constraint owner_charge_links_kind_check check (kind in ('expense', 'due', 'unit_charge'));

-- Mahsup bağlantısı tahsilatla birlikte yaşar: yalnız tahsilat iptali (RPC) siler; elle silinemez.
drop policy if exists owner_charge_links_delete on public.owner_charge_links;
create policy owner_charge_links_delete on public.owner_charge_links
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('rentals', 'edit'))
    and kind <> 'unit_charge'
  );

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.buildings enable row level security;
alter table public.building_units enable row level security;
alter table public.building_charge_batches enable row level security;
alter table public.building_charges enable row level security;
alter table public.building_payments enable row level security;

drop policy if exists buildings_select on public.buildings;
create policy buildings_select on public.buildings
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));
drop policy if exists buildings_insert on public.buildings;
create policy buildings_insert on public.buildings
  for insert to authenticated
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'create')));
drop policy if exists buildings_update on public.buildings;
create policy buildings_update on public.buildings
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')))
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')));

drop policy if exists building_units_select on public.building_units;
create policy building_units_select on public.building_units
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));
drop policy if exists building_units_insert on public.building_units;
create policy building_units_insert on public.building_units
  for insert to authenticated
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'create')));
drop policy if exists building_units_update on public.building_units;
create policy building_units_update on public.building_units
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')))
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')));

drop policy if exists building_batches_select on public.building_charge_batches;
create policy building_batches_select on public.building_charge_batches
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

drop policy if exists building_charges_select on public.building_charges;
create policy building_charges_select on public.building_charges
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

drop policy if exists building_payments_select on public.building_payments;
create policy building_payments_select on public.building_payments
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

revoke all on public.buildings from public, anon, authenticated;
revoke all on public.building_units from public, anon, authenticated;
revoke all on public.building_charge_batches from public, anon, authenticated;
revoke all on public.building_charges from public, anon, authenticated;
revoke all on public.building_payments from public, anon, authenticated;

grant select, insert, update on public.buildings to authenticated;
grant select, insert, update on public.building_units to authenticated;
grant select on public.building_charge_batches to authenticated;
grant select on public.building_charges to authenticated;
grant select on public.building_payments to authenticated;

grant all on public.buildings to service_role;
grant all on public.building_units to service_role;
grant all on public.building_charge_batches to service_role;
grant all on public.building_charges to service_role;
grant all on public.building_payments to service_role;

-- ---------------------------------------------------------------------------
-- İç yardımcı: tahakkuk ödenen toplam / durum / yönetim ücreti yeniden hesabı (istemciye AÇIK DEĞİL)
-- ---------------------------------------------------------------------------
create or replace function public.bm_recompute_charge(p_charge_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_charge public.building_charges%rowtype;
  p record;
  v_fee numeric;
  v_prior_fee numeric := 0;
  v_total numeric := 0;
  v_status text;
begin
  select c.* into v_charge from public.building_charges c where c.id = p_charge_id for update;
  if not found then
    return;
  end if;

  for p in
    select pay.id, pay.amount, pay.fee_type, pay.fee_value, pay.management_fee
      from public.building_payments pay
     where pay.charge_id = p_charge_id and pay.voided_at is null
     order by pay.created_at, pay.id
  loop
    v_fee := case p.fee_type
      when 'percent' then pg_catalog.round(p.amount * coalesce(p.fee_value, 0) / 100, 2)
      when 'fixed' then greatest(0, least(coalesce(p.fee_value, 0) - v_prior_fee, p.amount))
      else 0
    end;
    if p.management_fee is distinct from v_fee then
      update public.building_payments set management_fee = v_fee where id = p.id;
    end if;
    v_prior_fee := v_prior_fee + v_fee;
    v_total := v_total + p.amount;
  end loop;

  v_status := case when v_total >= v_charge.amount then 'paid' when v_total > 0 then 'partial' else 'pending' end;
  update public.building_charges set paid_amount = v_total, status = v_status where id = p_charge_id;
end;
$$;

revoke all on function public.bm_recompute_charge(uuid) from public, anon, authenticated;
grant execute on function public.bm_recompute_charge(uuid) to service_role;

-- İç yardımcı: tek tahsilat satırı (makbuz sırası + ücret anlık değeri + yeniden hesap + denetim). Kilit çağıranda alınır.
create or replace function public.bm_insert_payment(
  p_tenant uuid,
  p_actor uuid,
  p_charge public.building_charges,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_b public.buildings%rowtype;
  v_receipt integer;
  v_payment uuid;
  v_fee numeric;
  v_status text;
  v_paid numeric;
begin
  select b.* into v_b from public.buildings b where b.id = p_charge.building_id and b.tenant_id = p_tenant;

  insert into public.rent_receipt_counters (tenant_id, last_no) values (p_tenant, 1)
  on conflict (tenant_id) do update set last_no = public.rent_receipt_counters.last_no + 1
  returning last_no into v_receipt;

  insert into public.building_payments (
    tenant_id, charge_id, unit_id, building_id, amount, paid_on, method, bank_note, receipt_no, fee_type, fee_value, recorded_by
  ) values (
    p_tenant, p_charge.id, p_charge.unit_id, p_charge.building_id, p_amount, p_paid_on, p_method,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), v_receipt,
    case when v_b.managed_by_office then v_b.fee_type else null end,
    case when v_b.managed_by_office then v_b.fee_value else null end,
    p_actor
  ) returning id into v_payment;

  perform public.bm_recompute_charge(p_charge.id);
  select c.status, c.paid_amount into v_status, v_paid from public.building_charges c where c.id = p_charge.id;
  select pay.management_fee into v_fee from public.building_payments pay where pay.id = v_payment;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    p_tenant, p_actor, 'building_payment.record', 'building_payment', v_payment,
    jsonb_build_object(
      'building_id', p_charge.building_id, 'unit_id', p_charge.unit_id, 'charge_id', p_charge.id, 'amount', p_amount,
      'method', p_method, 'receipt_no', v_receipt, 'paid_on', p_paid_on, 'management_fee', v_fee, 'charge_status', v_status
    )
  );

  return jsonb_build_object('payment_id', v_payment, 'receipt_no', v_receipt, 'charge_status', v_status, 'paid_amount', v_paid, 'management_fee', v_fee);
end;
$$;

revoke all on function public.bm_insert_payment(uuid, uuid, public.building_charges, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.bm_insert_payment(uuid, uuid, public.building_charges, numeric, date, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: toplu tahakkuk (aidat dönemi ya da ortak gider paylaştırma)
--   p_shares = [{ "unit_id": uuid, "amount": number }, ...]  (hesap SAF fonksiyonla istemcide yapılır; burada DOĞRULANIR)
-- ---------------------------------------------------------------------------
create or replace function public.create_building_batch(
  p_building_id uuid,
  p_kind text,
  p_period date,
  p_title text,
  p_category text,
  p_total numeric,
  p_distribution text,
  p_due_date date,
  p_shares jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_building public.buildings%rowtype;
  v_batch uuid;
  v_count integer;
  v_sum numeric;
  v_valid integer;
  v_distinct integer;
  v_units integer;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('expenses', 'create') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if p_building_id is null
     or p_kind is null or p_kind not in ('aidat', 'expense_share')
     or p_period is null or extract(day from p_period) <> 1 or p_period < date '2000-01-01' or p_period > date '2100-01-01'
     or char_length(v_title) < 1 or char_length(v_title) > 160
     or char_length(coalesce(p_category, '')) > 60
     or p_total is null or p_total < 0.01 or p_total > 1000000000 or pg_catalog.round(p_total, 2) <> p_total
     or p_distribution is null or p_distribution not in ('equal', 'land_share', 'area', 'fixed')
     or p_due_date is null or p_due_date < date '2000-01-01' or p_due_date > date '2100-01-01'
     or p_shares is null or pg_catalog.jsonb_typeof(p_shares) <> 'array'
     or pg_catalog.jsonb_array_length(p_shares) < 1 or pg_catalog.jsonb_array_length(p_shares) > 2000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select b.* into v_building from public.buildings b where b.id = p_building_id and b.tenant_id = v_tenant and b.archived_at is null for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_kind = 'aidat' and exists (
    select 1 from public.building_charge_batches x
     where x.building_id = p_building_id and x.period = p_period and x.kind = 'aidat' and x.voided_at is null
  ) then
    return jsonb_build_object('outcome', 'duplicate_period');
  end if;

  -- Paylar: biçim + toplam + daire kümesi (bu binanın, etkin, tekrarsız) doğrulaması.
  begin
    select pg_catalog.count(*), pg_catalog.count(distinct (s ->> 'unit_id')), coalesce(pg_catalog.sum(round((s ->> 'amount')::numeric, 2)), 0),
           pg_catalog.count(*) filter (where (s ->> 'amount')::numeric >= 0.01 and pg_catalog.round((s ->> 'amount')::numeric, 2) = (s ->> 'amount')::numeric)
      into v_count, v_distinct, v_sum, v_valid
      from pg_catalog.jsonb_array_elements(p_shares) s;
    select pg_catalog.count(*) into v_units
      from pg_catalog.jsonb_array_elements(p_shares) s
      join public.building_units u on u.id = (s ->> 'unit_id')::uuid
       and u.tenant_id = v_tenant and u.building_id = p_building_id and u.active;
  exception when others then
    return jsonb_build_object('outcome', 'invalid_input');
  end;
  if v_count <> v_distinct or v_valid <> v_count or v_units <> v_count then
    return jsonb_build_object('outcome', 'invalid_shares');
  end if;
  if v_sum <> p_total then
    return jsonb_build_object('outcome', 'sum_mismatch', 'sum', v_sum);
  end if;

  insert into public.building_charge_batches (tenant_id, building_id, kind, period, title, category, total_amount, distribution, due_date, created_by)
  values (v_tenant, p_building_id, p_kind, p_period, v_title, nullif(pg_catalog.btrim(coalesce(p_category, '')), ''), p_total, p_distribution, p_due_date, v_uid)
  returning id into v_batch;

  insert into public.building_charges (tenant_id, batch_id, building_id, unit_id, amount, due_date, payer_role, payer_customer_id)
  select v_tenant, v_batch, p_building_id, u.id, pg_catalog.round((s ->> 'amount')::numeric, 2), p_due_date, u.payer,
         case u.payer when 'tenant' then u.tenant_customer_id else u.owner_customer_id end
    from pg_catalog.jsonb_array_elements(p_shares) s
    join public.building_units u on u.id = (s ->> 'unit_id')::uuid and u.tenant_id = v_tenant;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    v_tenant, v_uid, 'building_batch.create', 'building_charge_batch', v_batch,
    jsonb_build_object('building_id', p_building_id, 'kind', p_kind, 'period', p_period, 'total', p_total, 'distribution', p_distribution, 'units', v_count)
  );

  return jsonb_build_object('outcome', 'created', 'batch_id', v_batch, 'charge_count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: tahakkuk grubu iptali (ödeme varken iptal edilemez; silme yok)
-- ---------------------------------------------------------------------------
create or replace function public.void_building_batch(p_batch_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_batch public.building_charge_batches%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('expenses', 'delete') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_batch_id is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select x.* into v_batch from public.building_charge_batches x where x.id = p_batch_id and x.tenant_id = v_tenant for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_batch.voided_at is not null then
    return jsonb_build_object('outcome', 'already_voided');
  end if;
  -- Tahakkuk satırlarını kilitle (ödeme yarışı: record_building_payment da aynı sırada kilitler).
  perform 1 from public.building_charges c where c.batch_id = p_batch_id and c.tenant_id = v_tenant for update;
  if exists (
    select 1 from public.building_payments p
      join public.building_charges c on c.id = p.charge_id and c.tenant_id = p.tenant_id
     where c.batch_id = p_batch_id and c.tenant_id = v_tenant and p.voided_at is null
  ) then
    return jsonb_build_object('outcome', 'has_payments');
  end if;

  update public.building_charge_batches set voided_at = pg_catalog.now(), voided_by = v_uid, void_reason = v_reason where id = p_batch_id;
  update public.building_charges set voided_at = pg_catalog.now() where batch_id = p_batch_id and tenant_id = v_tenant;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    v_tenant, v_uid, 'building_batch.void', 'building_charge_batch', p_batch_id,
    jsonb_build_object('building_id', v_batch.building_id, 'kind', v_batch.kind, 'period', v_batch.period, 'total', v_batch.total_amount),
    jsonb_build_object('reason', v_reason)
  );
  return jsonb_build_object('outcome', 'voided');
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: tahsilat kaydı (kısmi ödeme dahil)
-- ---------------------------------------------------------------------------
create or replace function public.record_building_payment(
  p_charge_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_bank_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_charge public.building_charges%rowtype;
  v_remaining numeric;
  v_res jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('expenses', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if p_charge_id is null
     or p_amount is null or p_amount < 0.01 or p_amount > 1000000000 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_paid_on is null or p_paid_on > v_today or p_paid_on < date '2000-01-01'
     or p_method is null or p_method not in ('cash', 'bank_transfer', 'card', 'cheque')
     or char_length(coalesce(p_bank_note, '')) > 300 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select c.* into v_charge from public.building_charges c where c.id = p_charge_id and c.tenant_id = v_tenant and c.voided_at is null for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  v_remaining := v_charge.amount - v_charge.paid_amount;
  if v_remaining <= 0 then
    return jsonb_build_object('outcome', 'already_paid');
  end if;
  if p_amount > v_remaining then
    return jsonb_build_object('outcome', 'overpayment', 'remaining', v_remaining);
  end if;

  v_res := public.bm_insert_payment(v_tenant, v_uid, v_charge, p_amount, p_paid_on, p_method, p_bank_note);
  return jsonb_build_object('outcome', 'recorded') || v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: malikin aidat borcunu kira hakedişinden mahsup et (expenses:edit + rentals:edit)
-- ---------------------------------------------------------------------------
create or replace function public.offset_building_charge_to_owner(p_charge_id uuid, p_amount numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_charge public.building_charges%rowtype;
  v_unit public.building_units%rowtype;
  v_building_name text;
  v_remaining numeric;
  v_res jsonb;
  v_payment uuid;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('expenses', 'edit') or not public.has_effective_permission('rentals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_charge_id is null or p_amount is null or p_amount < 0.01 or p_amount > 1000000000 or pg_catalog.round(p_amount, 2) <> p_amount then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select c.* into v_charge from public.building_charges c where c.id = p_charge_id and c.tenant_id = v_tenant and c.voided_at is null for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_charge.payer_role <> 'owner' then
    return jsonb_build_object('outcome', 'payer_not_owner');
  end if;
  select u.* into v_unit from public.building_units u where u.id = v_charge.unit_id and u.tenant_id = v_tenant;
  if v_unit.rental_id is null or not exists (
    select 1 from public.rental_management_agreements a
     where a.rental_id = v_unit.rental_id and a.tenant_id = v_tenant and a.managed
  ) then
    return jsonb_build_object('outcome', 'not_managed');
  end if;
  v_remaining := v_charge.amount - v_charge.paid_amount;
  if v_remaining <= 0 then
    return jsonb_build_object('outcome', 'already_paid');
  end if;
  if p_amount > v_remaining then
    return jsonb_build_object('outcome', 'overpayment', 'remaining', v_remaining);
  end if;

  select b.name into v_building_name from public.buildings b where b.id = v_charge.building_id and b.tenant_id = v_tenant;
  v_res := public.bm_insert_payment(v_tenant, v_uid, v_charge, p_amount, v_today, 'owner_offset', 'Kira hakedişinden mahsup');
  v_payment := (v_res ->> 'payment_id')::uuid;

  insert into public.owner_charge_links (tenant_id, rental_id, kind, ref_id, amount, entry_date, label, created_by)
  values (
    v_tenant, v_unit.rental_id, 'unit_charge', v_payment, p_amount, v_today,
    pg_catalog.left('Bina aidatı: ' || coalesce(v_building_name, 'Bina') || ' · Daire ' || v_unit.unit_no, 160), v_uid
  );

  return jsonb_build_object('outcome', 'recorded') || v_res;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: tahsilat iptali (silme yok); mahsup tahsilatında hakediş bağlantısı da kalkar
-- ---------------------------------------------------------------------------
create or replace function public.void_building_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_pay public.building_payments%rowtype;
  v_charge_id uuid;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_status text;
  v_paid numeric;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('expenses', 'delete') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_payment_id is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select p.charge_id into v_charge_id from public.building_payments p where p.id = p_payment_id and p.tenant_id = v_tenant;
  if v_charge_id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform 1 from public.building_charges c where c.id = v_charge_id and c.tenant_id = v_tenant for update;

  select p.* into v_pay from public.building_payments p where p.id = p_payment_id and p.tenant_id = v_tenant for update;
  if v_pay.voided_at is not null then
    return jsonb_build_object('outcome', 'already_voided');
  end if;
  if v_pay.method = 'owner_offset' and not public.has_effective_permission('rentals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  update public.building_payments set voided_at = pg_catalog.now(), voided_by = v_uid, void_reason = v_reason where id = v_pay.id;
  if v_pay.method = 'owner_offset' then
    delete from public.owner_charge_links where tenant_id = v_tenant and kind = 'unit_charge' and ref_id = v_pay.id;
  end if;

  perform public.bm_recompute_charge(v_pay.charge_id);
  select c.status, c.paid_amount into v_status, v_paid from public.building_charges c where c.id = v_pay.charge_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    v_tenant, v_uid, 'building_payment.void', 'building_payment', v_pay.id,
    jsonb_build_object('amount', v_pay.amount, 'receipt_no', v_pay.receipt_no, 'paid_on', v_pay.paid_on, 'method', v_pay.method),
    jsonb_build_object('reason', v_reason, 'charge_id', v_pay.charge_id, 'charge_status', v_status, 'paid_amount', v_paid)
  );
  return jsonb_build_object('outcome', 'voided', 'charge_status', v_status, 'paid_amount', v_paid);
end;
$$;

-- ---------------------------------------------------------------------------
-- KPI: bu ay tahakkuk / tahsil / geciken / toplam borç (security invoker: RLS ve expenses:view geçerli)
-- ---------------------------------------------------------------------------
create or replace function public.building_dues_kpi(p_month date default null)
returns table (
  charged_month numeric,
  collected_month numeric,
  fee_month numeric,
  overdue_count bigint,
  overdue_total numeric,
  outstanding_total numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select d.d - (extract(day from d.d)::integer - 1) as m, d.today
      from (select coalesce(p_month, (pg_catalog.now() at time zone 'Europe/Istanbul')::date) as d,
                   (pg_catalog.now() at time zone 'Europe/Istanbul')::date as today) d
  )
  select
    coalesce((select sum(c.amount) from public.building_charges c, params p
               where c.tenant_id = (select public.current_active_tenant_id()) and c.voided_at is null
                 and c.due_date >= p.m and c.due_date < (p.m + interval '1 month')::date), 0),
    coalesce((select sum(pay.amount) from public.building_payments pay, params p
               where pay.tenant_id = (select public.current_active_tenant_id()) and pay.voided_at is null
                 and pay.paid_on >= p.m and pay.paid_on < (p.m + interval '1 month')::date), 0),
    coalesce((select sum(pay.management_fee) from public.building_payments pay, params p
               where pay.tenant_id = (select public.current_active_tenant_id()) and pay.voided_at is null
                 and pay.paid_on >= p.m and pay.paid_on < (p.m + interval '1 month')::date), 0),
    (select count(*) from public.building_charges c, params p
      where c.tenant_id = (select public.current_active_tenant_id()) and c.voided_at is null and c.status <> 'paid' and c.due_date < p.today),
    coalesce((select sum(c.amount - c.paid_amount) from public.building_charges c, params p
               where c.tenant_id = (select public.current_active_tenant_id()) and c.voided_at is null and c.status <> 'paid' and c.due_date < p.today), 0),
    coalesce((select sum(c.amount - c.paid_amount) from public.building_charges c
               where c.tenant_id = (select public.current_active_tenant_id()) and c.voided_at is null and c.status <> 'paid'), 0);
$$;

revoke all on function public.create_building_batch(uuid, text, date, text, text, numeric, text, date, jsonb) from public, anon;
revoke all on function public.void_building_batch(uuid, text) from public, anon;
revoke all on function public.record_building_payment(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.offset_building_charge_to_owner(uuid, numeric) from public, anon;
revoke all on function public.void_building_payment(uuid, text) from public, anon;
revoke all on function public.building_dues_kpi(date) from public, anon;
grant execute on function public.create_building_batch(uuid, text, date, text, text, numeric, text, date, jsonb) to authenticated, service_role;
grant execute on function public.void_building_batch(uuid, text) to authenticated, service_role;
grant execute on function public.record_building_payment(uuid, numeric, date, text, text) to authenticated, service_role;
grant execute on function public.offset_building_charge_to_owner(uuid, numeric) to authenticated, service_role;
grant execute on function public.void_building_payment(uuid, text) to authenticated, service_role;
grant execute on function public.building_dues_kpi(date) to authenticated, service_role;

comment on function public.create_building_batch(uuid, text, date, text, text, numeric, text, date, jsonb) is 'Toplu tahakkuk: paylar istemcide SAF fonksiyonla hesaplanır; RPC daire kümesini (bu bina, etkin, tekrarsız) ve toplamı doğrular. Yetki içerde (expenses:create).';
comment on function public.record_building_payment(uuid, numeric, date, text, text) is 'Bina aidatı tahsilatı: tahakkuk kilidi, fazla ödeme reddi, ortak makbuz sırası, yönetim ücreti anlık değeri, denetim kaydı tek transaction. Yetki içerde (expenses:edit).';
comment on function public.offset_building_charge_to_owner(uuid, numeric) is 'Malik aidat borcunu kira hakedişinden mahsup eder (tahsilat method=owner_offset + owner_charge_links unit_charge). expenses:edit + rentals:edit gerekir.';

notify pgrst, 'reload schema';
