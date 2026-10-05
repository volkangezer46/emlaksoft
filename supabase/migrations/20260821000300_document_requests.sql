-- F4: Evrak toplama linki (token'li, sureli, sinirli, iptal edilebilir). TASLAK: canli DB'ye uygulanmadi.
-- Forward-only, yeniden calistirilabilir. Ham token SAKLANMAZ; yalniz SHA-256 ozeti (token_hash).
-- Public yukleme yalniz service_role (sunucu) uzerinden yapilir; authenticated yalniz kendi ofisini okur/iptal eder.
-- Dosyalar ozel `customer-files` bucket'inda: <tenant_id>/<request_id>/<file_id>.<uzanti>.

create table if not exists public.document_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete set null,
  property_id     uuid references public.properties(id) on delete set null,
  title           text not null check (char_length(title) between 1 and 160),
  requested_types text[] not null default '{}',
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  max_files       int not null default 10 check (max_files between 1 and 20),
  file_count      int not null default 0 check (file_count >= 0),
  status          text not null default 'active' check (status in ('active','completed','revoked')),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  completed_at    timestamptz,
  last_opened_at  timestamptz,
  is_sample       boolean not null default false,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_document_requests_tenant
  on public.document_requests (tenant_id, status, expires_at);
create index if not exists idx_document_requests_customer
  on public.document_requests (customer_id) where customer_id is not null;
create index if not exists idx_document_requests_property
  on public.document_requests (property_id) where property_id is not null;

create table if not exists public.document_request_files (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  request_id    uuid not null references public.document_requests(id) on delete cascade,
  doc_type      text not null,
  storage_path  text not null,
  file_name     text not null,
  file_size     bigint not null check (file_size > 0),
  mime_type     text not null,
  status        text not null default 'pending' check (status in ('pending','verified','blocked')),
  is_sample     boolean not null default false,
  created_at    timestamptz not null default now(),
  verified_at   timestamptz
);

create index if not exists idx_document_request_files_request
  on public.document_request_files (request_id, created_at);
create index if not exists idx_document_request_files_tenant
  on public.document_request_files (tenant_id);

alter table public.document_requests enable row level security;
alter table public.document_request_files enable row level security;

drop policy if exists document_requests_tenant_select on public.document_requests;
create policy document_requests_tenant_select on public.document_requests
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists document_requests_tenant_insert on public.document_requests;
create policy document_requests_tenant_insert on public.document_requests
  for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists document_requests_tenant_update on public.document_requests;
create policy document_requests_tenant_update on public.document_requests
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists document_requests_staff on public.document_requests;
create policy document_requests_staff on public.document_requests
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

drop policy if exists document_request_files_tenant_select on public.document_request_files;
create policy document_request_files_tenant_select on public.document_request_files
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists document_request_files_staff on public.document_request_files;
create policy document_request_files_staff on public.document_request_files
  for all using (public.is_platform_staff()) with check (public.is_platform_staff());

grant select, insert, update on public.document_requests to authenticated;
grant select on public.document_request_files to authenticated;

notify pgrst, 'reload schema';
