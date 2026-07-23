-- EmlakSoft initial schema
-- Target: Supabase Postgres (eu-central-1)
-- Multi-tenant with RLS on tenant_id

create extension if not exists "pgcrypto";

-- ========== GEO ==========
create table if not exists public.geo_provinces (
  id uuid primary key default gen_random_uuid(),
  plate_code smallint not null unique,
  name text not null unique,
  ibbs1 text,
  ibbs2 text,
  lat double precision,
  lng double precision,
  is_active boolean not null default true
);

create table if not exists public.geo_districts (
  id uuid primary key default gen_random_uuid(),
  province_id uuid not null references public.geo_provinces(id),
  name text not null,
  lat double precision,
  lng double precision,
  is_active boolean not null default true,
  unique (province_id, name)
);

create table if not exists public.geo_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.geo_districts(id),
  name text not null,
  lat double precision,
  lng double precision,
  is_active boolean not null default true,
  unique (district_id, name)
);

create index if not exists idx_geo_districts_province on public.geo_districts(province_id);
create index if not exists idx_geo_neighborhoods_district on public.geo_neighborhoods(district_id);

-- ========== TENANCY ==========
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'office' check (plan in ('advisor','office','professional','enterprise')),
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz,
  logo_url text,
  brand_color text,
  tax_office text,
  tax_number text,
  license_no text,
  province_id uuid references public.geo_provinces(id),
  district_id uuid references public.geo_districts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  manager_user_id uuid,
  province_id uuid references public.geo_provinces(id),
  district_id uuid references public.geo_districts(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_branches_tenant on public.branches(tenant_id);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id),
  full_name text not null,
  phone text,
  role text not null default 'advisor'
    check (role in ('owner','gm','branch_manager','team_lead','advisor','call_center','accounting','readonly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_profiles_tenant on public.profiles(tenant_id);

-- ========== CRM ==========
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id),
  assigned_to uuid references public.profiles(id),
  full_name text not null,
  phone text,
  email text,
  customer_types text[] not null default '{}',
  source text,
  tags text[] not null default '{}',
  blacklist boolean not null default false,
  notes text,
  province_id uuid references public.geo_provinces(id),
  district_id uuid references public.geo_districts(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_customers_tenant on public.customers(tenant_id);
create index if not exists idx_customers_phone on public.customers(tenant_id, phone);

create table if not exists public.customer_demands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  transaction_type text not null,
  property_type text,
  province_id uuid references public.geo_provinces(id),
  district_id uuid references public.geo_districts(id),
  neighborhood_id uuid references public.geo_neighborhoods(id),
  budget_min numeric,
  budget_max numeric,
  rooms text,
  min_sqm numeric,
  urgency text,
  status text not null default 'new',
  criteria jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_demands_tenant on public.customer_demands(tenant_id, customer_id);

-- ========== PORTFOLIO ==========
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id),
  property_code text not null,
  title text,
  transaction_type text not null,
  property_type text not null,
  status text not null default 'draft',
  list_price numeric,
  min_price numeric,
  hidden_price numeric,
  commission_rate numeric,
  assigned_to uuid references public.profiles(id),
  source_agent uuid references public.profiles(id),
  province_id uuid references public.geo_provinces(id),
  district_id uuid references public.geo_districts(id),
  neighborhood_id uuid references public.geo_neighborhoods(id),
  address_line text,
  parcel_block text,
  parcel_lot text,
  features jsonb not null default '{}',
  price_health text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, property_code)
);
create index if not exists idx_properties_tenant on public.properties(tenant_id, status);

create table if not exists public.portal_listings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  portal_name text not null,
  portal_listing_id text,
  portal_url text,
  status text not null default 'live',
  last_confirmed_at timestamptz,
  published_at timestamptz,
  removed_at timestamptz,
  removal_reason text,
  removal_meta jsonb not null default '{}',
  published_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_portal_listings_tenant on public.portal_listings(tenant_id, status);

create table if not exists public.listing_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  portal_listing_id uuid not null references public.portal_listings(id) on delete cascade,
  reason text not null,
  deal_happened boolean,
  deal_amount numeric,
  closed_by_us boolean,
  competitor_closed boolean,
  evidence_url text,
  notes text,
  estimated_lost_commission numeric,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ========== DEALS & COMMISSION ==========
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id),
  customer_id uuid references public.customers(id),
  deal_type text not null check (deal_type in ('sale','rent')),
  stage text not null default 'new',
  deal_value numeric,
  probability numeric,
  assigned_to uuid references public.profiles(id),
  loss_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  gross_amount numeric not null,
  vat_amount numeric not null default 0,
  status text not null default 'calculated',
  splits jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id),
  direction text not null check (direction in ('inbound','outbound','missed')),
  phone text not null,
  duration_sec integer,
  disposition text,
  notes text,
  handled_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists idx_calls_tenant on public.calls(tenant_id, started_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_tenant on public.audit_logs(tenant_id, created_at desc);

-- ========== HELPERS ==========
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', '');
$$;

-- ========== RLS ==========
alter table public.tenants enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.customer_demands enable row level security;
alter table public.properties enable row level security;
alter table public.portal_listings enable row level security;
alter table public.listing_closures enable row level security;
alter table public.deals enable row level security;
alter table public.commissions enable row level security;
alter table public.calls enable row level security;
alter table public.audit_logs enable row level security;

-- Geo is public read (reference data)
alter table public.geo_provinces enable row level security;
alter table public.geo_districts enable row level security;
alter table public.geo_neighborhoods enable row level security;

create policy geo_provinces_read on public.geo_provinces for select using (true);
create policy geo_districts_read on public.geo_districts for select using (true);
create policy geo_neighborhoods_read on public.geo_neighborhoods for select using (true);

create policy tenants_select on public.tenants for select
  using (id = public.current_tenant_id());

create policy branches_tenant on public.branches for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy profiles_tenant on public.profiles for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy customers_tenant on public.customers for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy demands_tenant on public.customer_demands for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy properties_tenant on public.properties for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy portal_listings_tenant on public.portal_listings for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy closures_tenant on public.listing_closures for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy deals_tenant on public.deals for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy commissions_tenant on public.commissions for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy calls_tenant on public.calls for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy audit_tenant on public.audit_logs for select
  using (tenant_id = public.current_tenant_id());
