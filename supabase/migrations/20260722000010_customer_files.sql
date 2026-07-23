-- Müşteri dosya deposu (360 genişlemesi)
create table if not exists public.customer_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  file_name text not null,
  file_size bigint not null,
  file_type text not null,
  storage_path text not null,
  label text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_files_customer on public.customer_files(tenant_id, customer_id, created_at desc);

alter table public.customer_files enable row level security;

create policy customer_files_tenant on public.customer_files for all
  using (tenant_id = (select auth.jwt()->>'tenant_id')::uuid);

grant all on public.customer_files to authenticated, service_role;

comment on table public.customer_files is
  'Müşteri belgeleri ve medya: kimlik, sözleşme, fotoğraf';
