-- Payment links, share tokens, valuations, IYS consents

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique,
  title text not null,
  amount_try numeric not null,
  status text not null default 'open' check (status in ('open','paid','cancelled','expired')),
  customer_id uuid references public.customers(id) on delete set null,
  commission_id uuid references public.commissions(id) on delete set null,
  paid_at timestamptz,
  expires_at timestamptz,
  meta jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_payment_links_tenant on public.payment_links(tenant_id, created_at desc);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique,
  entity_type text not null check (entity_type in ('property','customer','demand')),
  entity_id uuid not null,
  label text,
  expires_at timestamptz,
  view_count integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_share_links_token on public.share_links(token);

create table if not exists public.valuations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  title text not null,
  estimated_low numeric,
  estimated_mid numeric,
  estimated_high numeric,
  confidence numeric,
  sources jsonb not null default '[]',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_valuations_tenant on public.valuations(tenant_id, created_at desc);

create table if not exists public.iys_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  channel text not null check (channel in ('sms','email','whatsapp','call')),
  status text not null default 'unknown' check (status in ('granted','denied','unknown','pending')),
  source text,
  granted_at timestamptz,
  revoked_at timestamptz,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, customer_id, channel)
);

alter table public.payment_links enable row level security;
alter table public.share_links enable row level security;
alter table public.valuations enable row level security;
alter table public.iys_consents enable row level security;

drop policy if exists payment_links_tenant on public.payment_links;
create policy payment_links_tenant on public.payment_links for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists share_links_tenant on public.share_links;
create policy share_links_tenant on public.share_links for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists valuations_tenant on public.valuations;
create policy valuations_tenant on public.valuations for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists iys_consents_tenant on public.iys_consents;
create policy iys_consents_tenant on public.iys_consents for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

grant all on public.payment_links, public.share_links, public.valuations, public.iys_consents to authenticated, service_role;

-- Public read for open share/payment by token via service role in routes only
