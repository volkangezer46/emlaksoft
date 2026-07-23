-- Appointments & showings (GPS + digital signature ready)
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id),
  customer_id uuid references public.customers(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  appointment_type text not null default 'showing'
    check (appointment_type in ('showing','office','valuation','contract')),
  scheduled_at timestamptz not null,
  duration_min integer,
  location text,
  status text not null default 'pending'
    check (status in ('pending','confirmed','signature','completed','cancelled')),
  notes text,
  gps_lat double precision,
  gps_lng double precision,
  signed_at timestamptz,
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_appointments_tenant on public.appointments(tenant_id, scheduled_at);

alter table public.appointments enable row level security;

drop policy if exists appointments_tenant on public.appointments;
create policy appointments_tenant on public.appointments for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

grant all on public.appointments to authenticated, service_role;
