-- Mülk Yönetimi v1 (kiralama modülü)
--
-- Üç tablo:
--  * rentals              — kira sözleşmesi kaydı: portföy + kiracı (customers) + aylık kira + vade günü
--  * rent_charges         — aylık kira tahakkukları (dönem = ay başı; rental+dönem tekil)
--  * maintenance_requests — kiralık mülke bağlı bakım/arıza talepleri
--
-- Tasarım kararları:
--  * Kiracı için YENİ kişi tablosu yok — mevcut `customers` kaydına fk (renter_customer_id).
--    Uygulama tarafı müşteriyi 'Kiracı' tip etiketiyle işaretler (customer_types dizisi).
--  * due_day 1-28 aralığında — Şubat dahil her ayda geçerli bir vade günü garantisi.
--  * rent_charges.period her zaman AY BAŞI tarihi (check ile zorlanır); unique(rental_id, period)
--    cron'un aynı ayı iki kez tahakkuk etmesini DB seviyesinde keser.
--  * RLS: diğer tenant tabloları ile aynı desen (bkz. deal_costs) — current_tenant_id().

-- ============================================================
-- rentals — kira sözleşmesi kaydı
-- ============================================================
create table if not exists public.rentals (
  id                 uuid          primary key default gen_random_uuid(),
  tenant_id          uuid          not null references public.tenants(id)    on delete cascade,
  property_id        uuid          not null references public.properties(id) on delete cascade,
  renter_customer_id uuid          not null references public.customers(id)  on delete cascade,
  monthly_rent       numeric(14,2) not null check (monthly_rent > 0),
  due_day            integer       not null check (due_day between 1 and 28),
  start_date         date          not null,
  end_date           date,
  deposit            numeric(14,2) check (deposit >= 0),
  status             text          not null default 'active' check (status in ('active', 'ended')),
  notes              text,
  created_by         uuid          references public.profiles(id) on delete set null,
  created_at         timestamptz   not null default now()
);

comment on table  public.rentals                    is 'Mülk yönetimi — kira sözleşmesi kayıtları (portföy × kiracı müşteri)';
comment on column public.rentals.renter_customer_id is 'Kiracı = mevcut customers kaydı (ayrı kişi tablosu yok; tip etiketi uygulamada eklenir)';
comment on column public.rentals.due_day            is 'Aylık kira vade günü (1-28 — her ayda geçerli)';
comment on column public.rentals.end_date           is 'Sözleşme bitişi; null = süresiz/belirsiz. 30 gün kala UI amber uyarı gösterir';

create index if not exists idx_rentals_tenant   on public.rentals(tenant_id, created_at desc);
create index if not exists idx_rentals_property on public.rentals(property_id);
create index if not exists idx_rentals_renter   on public.rentals(renter_customer_id);
create index if not exists idx_rentals_status   on public.rentals(tenant_id, status);

-- ============================================================
-- rent_charges — aylık tahakkuklar
-- ============================================================
create table if not exists public.rent_charges (
  id         uuid          primary key default gen_random_uuid(),
  tenant_id  uuid          not null references public.tenants(id) on delete cascade,
  rental_id  uuid          not null references public.rentals(id) on delete cascade,
  period     date          not null check (extract(day from period) = 1),
  amount     numeric(14,2) not null check (amount > 0),
  status     text          not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  paid_at    timestamptz,
  created_at timestamptz   not null default now(),
  unique (rental_id, period)
);

comment on table  public.rent_charges        is 'Aylık kira tahakkukları — cron (/api/cron/kira-tahakkuk) veya manuel oluşturulur';
comment on column public.rent_charges.period is 'Tahakkuk dönemi — her zaman ayın 1''i (check ile zorlanır)';
comment on column public.rent_charges.status is 'pending → paid (elle) | pending → overdue (cron: vade + 7 gün)';

create index if not exists idx_rent_charges_tenant on public.rent_charges(tenant_id, period desc);
create index if not exists idx_rent_charges_rental on public.rent_charges(rental_id, period desc);
create index if not exists idx_rent_charges_status on public.rent_charges(tenant_id, status);

-- ============================================================
-- maintenance_requests — bakım / arıza talepleri
-- ============================================================
create table if not exists public.maintenance_requests (
  id          uuid          primary key default gen_random_uuid(),
  tenant_id   uuid          not null references public.tenants(id) on delete cascade,
  rental_id   uuid          not null references public.rentals(id) on delete cascade,
  title       text          not null,
  description text,
  status      text          not null default 'open' check (status in ('open', 'in_progress', 'done')),
  cost        numeric(14,2) check (cost >= 0),
  created_by  uuid          references public.profiles(id) on delete set null,
  created_at  timestamptz   not null default now()
);

comment on table  public.maintenance_requests      is 'Kiralık mülk bakım/arıza talepleri (kira kaydına bağlı)';
comment on column public.maintenance_requests.cost is 'Gerçekleşen maliyet — genellikle done aşamasında girilir';

create index if not exists idx_maintenance_requests_tenant on public.maintenance_requests(tenant_id, created_at desc);
create index if not exists idx_maintenance_requests_rental on public.maintenance_requests(rental_id, created_at desc);
create index if not exists idx_maintenance_requests_status on public.maintenance_requests(tenant_id, status);

-- ============================================================
-- RLS — tenant izolasyonu (deal_costs ile aynı desen)
-- ============================================================
alter table public.rentals              enable row level security;
alter table public.rent_charges         enable row level security;
alter table public.maintenance_requests enable row level security;

drop policy if exists rentals_tenant        on public.rentals;
drop policy if exists rentals_tenant_insert on public.rentals;
create policy rentals_tenant on public.rentals
  using (tenant_id = public.current_tenant_id());
create policy rentals_tenant_insert on public.rentals for insert
  with check (tenant_id = public.current_tenant_id());

drop policy if exists rent_charges_tenant        on public.rent_charges;
drop policy if exists rent_charges_tenant_insert on public.rent_charges;
create policy rent_charges_tenant on public.rent_charges
  using (tenant_id = public.current_tenant_id());
create policy rent_charges_tenant_insert on public.rent_charges for insert
  with check (tenant_id = public.current_tenant_id());

drop policy if exists maintenance_requests_tenant        on public.maintenance_requests;
drop policy if exists maintenance_requests_tenant_insert on public.maintenance_requests;
create policy maintenance_requests_tenant on public.maintenance_requests
  using (tenant_id = public.current_tenant_id());
create policy maintenance_requests_tenant_insert on public.maintenance_requests for insert
  with check (tenant_id = public.current_tenant_id());

grant all on public.rentals              to authenticated, service_role;
grant all on public.rent_charges         to authenticated, service_role;
grant all on public.maintenance_requests to authenticated, service_role;

-- ============================================================
-- permission_defaults seed — 'rentals' modülü
-- src/lib/permissions.ts DEFAULT_MATRIX ile BİREBİR tutulur (bkz. 20260722000014
-- dosya başındaki senkron notu): owner/gm ALL, branch_manager view-create-edit,
-- advisor view.
-- ============================================================
insert into public.permission_defaults (role, module, action)
select r, 'rentals', a
from (values ('owner'), ('gm')) as roles(r)
cross join (values ('view'), ('create'), ('edit'), ('delete')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
select 'branch_manager', 'rentals', a
from (values ('view'), ('create'), ('edit')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
values ('advisor', 'rentals', 'view')
on conflict do nothing;
