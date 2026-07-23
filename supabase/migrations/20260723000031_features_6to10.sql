-- Masraf/gider takibi, teklif yönetimi, hedef/kota, açık ev, kaynak takibi
-- Beş modül tek migration'da.

-- ============================================================
-- 6. Masraf / gider takibi
-- ============================================================
create type public.expense_category as enum (
  'reklam', 'ofis', 'ulasim', 'egitim', 'komisyon_gider', 'diger'
);

create table if not exists public.expenses (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  created_by    uuid        references public.profiles(id) on delete set null,
  property_id   uuid        references public.properties(id) on delete set null,
  category      public.expense_category not null default 'diger',
  title         text        not null,
  amount        numeric(12,2) not null default 0,
  currency      text        not null default 'TRY',
  expense_date  date        not null default current_date,
  notes         text,
  receipt_url   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_expenses_tenant
  on public.expenses(tenant_id, expense_date desc);

alter table public.expenses enable row level security;
create policy expenses_tenant on public.expenses
  using (tenant_id = public.current_tenant_id());
create policy expenses_tenant_insert on public.expenses for insert
  with check (tenant_id = public.current_tenant_id());
create policy expenses_tenant_update on public.expenses for update
  using (tenant_id = public.current_tenant_id());

grant all on public.expenses to authenticated, service_role;

-- ============================================================
-- 7. Teklif yönetimi
-- ============================================================
create type public.offer_status as enum (
  'draft', 'submitted', 'countered', 'accepted', 'rejected', 'withdrawn'
);

create table if not exists public.offers (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  property_id   uuid        not null references public.properties(id) on delete cascade,
  customer_id   uuid        references public.customers(id) on delete set null,
  created_by    uuid        references public.profiles(id) on delete set null,
  amount        numeric(14,2) not null,
  currency      text        not null default 'TRY',
  status        public.offer_status not null default 'draft',
  counter_amount numeric(14,2),
  valid_until   date,
  notes         text,
  submitted_at  timestamptz,
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_offers_tenant
  on public.offers(tenant_id, created_at desc);
create index if not exists idx_offers_property
  on public.offers(property_id);

alter table public.offers enable row level security;
create policy offers_tenant on public.offers
  using (tenant_id = public.current_tenant_id());
create policy offers_tenant_insert on public.offers for insert
  with check (tenant_id = public.current_tenant_id());
create policy offers_tenant_update on public.offers for update
  using (tenant_id = public.current_tenant_id());

grant all on public.offers to authenticated, service_role;

-- ============================================================
-- 8. Hedef / kota takibi
-- ============================================================
create type public.target_period as enum ('monthly', 'quarterly', 'yearly');

create table if not exists public.targets (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  profile_id    uuid        references public.profiles(id) on delete cascade,
  period        public.target_period not null default 'monthly',
  period_start  date        not null,
  target_deals  int         not null default 0,
  target_revenue numeric(14,2) not null default 0,
  actual_deals  int         not null default 0,
  actual_revenue numeric(14,2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_targets_tenant
  on public.targets(tenant_id, period_start desc);

alter table public.targets enable row level security;
create policy targets_tenant on public.targets
  using (tenant_id = public.current_tenant_id());
create policy targets_tenant_insert on public.targets for insert
  with check (tenant_id = public.current_tenant_id());
create policy targets_tenant_update on public.targets for update
  using (tenant_id = public.current_tenant_id());

grant all on public.targets to authenticated, service_role;

-- ============================================================
-- 9. Açık ev (open house) takibi
-- ============================================================
create table if not exists public.open_houses (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  property_id   uuid        not null references public.properties(id) on delete cascade,
  created_by    uuid        references public.profiles(id) on delete set null,
  scheduled_at  timestamptz not null,
  duration_min  int         not null default 120,
  location      text,
  notes         text,
  max_visitors  int,
  visitor_count int         not null default 0,
  status        text        not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  created_at    timestamptz not null default now()
);

create index if not exists idx_open_houses_tenant
  on public.open_houses(tenant_id, scheduled_at desc);

create table if not exists public.open_house_visitors (
  id            uuid        primary key default gen_random_uuid(),
  open_house_id uuid        not null references public.open_houses(id) on delete cascade,
  full_name     text        not null,
  phone         text,
  email         text,
  notes         text,
  created_customer_id uuid references public.customers(id) on delete set null,
  registered_at timestamptz not null default now()
);

alter table public.open_houses         enable row level security;
alter table public.open_house_visitors enable row level security;

create policy open_houses_tenant on public.open_houses
  using (tenant_id = public.current_tenant_id());
create policy open_houses_tenant_insert on public.open_houses for insert
  with check (tenant_id = public.current_tenant_id());

create policy open_house_visitors_tenant on public.open_house_visitors
  using (open_house_id in (
    select id from public.open_houses where tenant_id = public.current_tenant_id()
  ));
create policy open_house_visitors_insert on public.open_house_visitors for insert
  with check (open_house_id in (
    select id from public.open_houses where tenant_id = public.current_tenant_id()
  ));

grant all on public.open_houses         to authenticated, service_role;
grant all on public.open_house_visitors to authenticated, service_role;

-- ============================================================
-- 10. Referans / kaynak takibi (customers tablosuna kolon ekle)
-- ============================================================
alter table public.customers
  add column if not exists lead_source text,
  add column if not exists lead_source_detail text;

-- lead_source önerilen değerler (kod içinde sabitlenecek):
-- 'portal_sahibinden', 'portal_hepsiemlak', 'portal_zingat',
-- 'tavsiye', 'sosyal_medya', 'web_sitesi', 'telefon', 'ofis_ziyareti', 'diger'

comment on column public.customers.lead_source is
  'Müşterinin hangi kanaldan geldiği: portal_sahibinden, tavsiye, sosyal_medya, vb.';
comment on column public.customers.lead_source_detail is
  'Kaynak detayı: tavsiye eden kişi adı, reklam kampanyası adı, vb.';
