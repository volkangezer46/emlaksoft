-- Sözleşme ve e-imza modülü
-- contracts: sözleşme kaydı (taslak, gönderildi, imzalandı, iptal)
-- contract_signers: her imzalayan için token + durum

create type public.contract_status as enum ('draft', 'sent', 'signed', 'rejected', 'cancelled');
create type public.contract_type   as enum ('satis', 'kira', 'sozlesme', 'teklif', 'diger');
create type public.signer_status   as enum ('pending', 'signed', 'rejected');

create table if not exists public.contracts (
  id              uuid          primary key default gen_random_uuid(),
  tenant_id       uuid          not null references public.tenants(id) on delete cascade,
  created_by      uuid          references public.profiles(id) on delete set null,
  property_id     uuid          references public.properties(id) on delete set null,
  customer_id     uuid          references public.customers(id) on delete set null,
  contract_type   public.contract_type not null default 'diger',
  title           text          not null,
  body            text          not null default '',  -- HTML veya markdown içerik
  status          public.contract_status not null default 'draft',
  signed_at       timestamptz,
  cancelled_at    timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create index if not exists idx_contracts_tenant
  on public.contracts(tenant_id, created_at desc);

create index if not exists idx_contracts_property
  on public.contracts(property_id);

create index if not exists idx_contracts_customer
  on public.contracts(customer_id);

create table if not exists public.contract_signers (
  id            uuid          primary key default gen_random_uuid(),
  contract_id   uuid          not null references public.contracts(id) on delete cascade,
  full_name     text          not null,
  email         text,
  phone         text,
  token         text          not null unique default encode(gen_random_bytes(24), 'hex'),
  status        public.signer_status not null default 'pending',
  ip_address    text,
  signed_at     timestamptz,
  created_at    timestamptz   not null default now()
);

create index if not exists idx_contract_signers_contract
  on public.contract_signers(contract_id);

create index if not exists idx_contract_signers_token
  on public.contract_signers(token);

-- RLS
alter table public.contracts        enable row level security;
alter table public.contract_signers enable row level security;

create policy contracts_tenant on public.contracts
  using (tenant_id = public.current_tenant_id());

create policy contracts_tenant_insert on public.contracts for insert
  with check (tenant_id = public.current_tenant_id());

create policy contracts_tenant_update on public.contracts for update
  using (tenant_id = public.current_tenant_id());

create policy contract_signers_tenant on public.contract_signers
  using (
    contract_id in (
      select id from public.contracts where tenant_id = public.current_tenant_id()
    )
  );

create policy contract_signers_insert on public.contract_signers for insert
  with check (
    contract_id in (
      select id from public.contracts where tenant_id = public.current_tenant_id()
    )
  );

-- Public imza erişimi (token ile — RLS bypass için service_role kullanılır)
-- updated_at trigger
create or replace function public.set_contracts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contracts_updated_at
  before update on public.contracts
  for each row execute function public.set_contracts_updated_at();

grant all on public.contracts        to authenticated, service_role;
grant all on public.contract_signers to authenticated, service_role;
