-- EmlakSoft kendi satış CRM'i: landing/demo formundan gelen talepler.
-- Tenant'a bağlı DEĞİL — bu EmlakSoft'un kendi lead havuzudur (platform staff yönetir).
-- HGDekor "form-talepleri + leadler" karşılığı, SaaS satış hunisi için.

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  company text,
  city text,
  team_size text,
  message text,
  source text not null default 'demo_form',
  status text not null default 'new'
    check (status in ('new','contacted','qualified','won','lost')),
  assigned_to uuid references public.platform_staff(id) on delete set null,
  notes text,
  converted_tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_demo_requests_status on public.demo_requests(status, created_at desc);
create index if not exists idx_demo_requests_assignee on public.demo_requests(assigned_to);
create index if not exists idx_demo_requests_created on public.demo_requests(created_at desc);

alter table public.demo_requests enable row level security;

-- Yalnızca aktif platform staff görebilir/yönetebilir; form girişi service_role ile yapılır.
drop policy if exists demo_requests_platform on public.demo_requests;
create policy demo_requests_platform on public.demo_requests
  for all
  using (public.is_platform_staff())
  with check (public.is_platform_staff());

grant select, insert, update, delete on public.demo_requests to authenticated;
grant all on public.demo_requests to service_role;

comment on table public.demo_requests is
  'EmlakSoft satış hunisi: demo/iletişim formu talepleri (platform-level, tenant bağımsız)';
