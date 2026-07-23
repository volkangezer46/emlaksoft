-- Müşteri self-servis portal erişim tokenları
-- Her müşteriye benzersiz link verilir; müşteri kendi arayışını ve eşleşmeleri görebilir.

create table if not exists public.customer_portal_tokens (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  customer_id uuid        not null references public.customers(id) on delete cascade,
  token       text        not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at  timestamptz not null default (now() + interval '90 days'),
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists idx_customer_portal_tokens_token
  on public.customer_portal_tokens(token);

create index if not exists idx_customer_portal_tokens_customer
  on public.customer_portal_tokens(customer_id);

-- RLS: Tenant kullanıcıları kendi tokenlarını yönetebilir
alter table public.customer_portal_tokens enable row level security;

create policy customer_portal_tokens_tenant on public.customer_portal_tokens
  using (tenant_id = public.current_tenant_id());

create policy customer_portal_tokens_tenant_insert on public.customer_portal_tokens for insert
  with check (tenant_id = public.current_tenant_id());

-- Service role: token ile public erişim (RLS bypass)
grant all on public.customer_portal_tokens to authenticated, service_role;
