-- Malik (mülk sahibi) self-servis portal erişim tokenları
-- Malik, kendi portföyünün ilanını, görüntülenmeleri ve teklifleri görebilir.

create table if not exists public.owner_portal_tokens (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  property_id   uuid        not null references public.properties(id) on delete cascade,
  owner_name    text        not null,
  owner_phone   text,
  token         text        not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at    timestamptz not null default (now() + interval '180 days'),
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

create index if not exists idx_owner_portal_tokens_token
  on public.owner_portal_tokens(token);

create index if not exists idx_owner_portal_tokens_property
  on public.owner_portal_tokens(property_id);

-- RLS: Tenant kullanıcıları kendi tokenlarını yönetebilir
alter table public.owner_portal_tokens enable row level security;

create policy owner_portal_tokens_tenant on public.owner_portal_tokens
  using (tenant_id = public.current_tenant_id());

create policy owner_portal_tokens_insert on public.owner_portal_tokens for insert
  with check (tenant_id = public.current_tenant_id());

grant all on public.owner_portal_tokens to authenticated, service_role;
