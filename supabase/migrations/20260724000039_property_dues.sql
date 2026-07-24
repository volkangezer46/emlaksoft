-- Aidat / ortak gider takibi — portföy bazlı aylık aidat ve ödeme durumu
create table if not exists public.property_dues (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  created_by    uuid        references public.profiles(id) on delete set null,
  property_id   uuid        references public.properties(id) on delete set null,
  title         text        not null,
  amount        numeric(12,2) not null default 0,
  period        date        not null default current_date,  -- ilgili ay (gün=1 önerilir)
  due_date      date,
  status        text        not null default 'unpaid' check (status in ('unpaid','paid')),
  paid_at       timestamptz,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_property_dues_tenant
  on public.property_dues(tenant_id, period desc);
create index if not exists idx_property_dues_status
  on public.property_dues(tenant_id, status);

alter table public.property_dues enable row level security;
create policy property_dues_tenant on public.property_dues
  using (tenant_id = public.current_tenant_id());
create policy property_dues_tenant_insert on public.property_dues for insert
  with check (tenant_id = public.current_tenant_id());
create policy property_dues_tenant_update on public.property_dues for update
  using (tenant_id = public.current_tenant_id());

grant all on public.property_dues to authenticated, service_role;
