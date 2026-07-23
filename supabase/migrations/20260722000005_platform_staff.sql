-- EmlakSoft platform staff (software company employees — Super Admin)
-- Separate from tenant `profiles`. Only these users may access /admin.

create table if not exists public.platform_staff (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'support'
    check (role in ('super_admin','ops','support','billing')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_platform_staff_active on public.platform_staff(is_active);

alter table public.platform_staff enable row level security;

-- Staff can read their own row; all writes go through service_role
drop policy if exists platform_staff_self_select on public.platform_staff;
create policy platform_staff_self_select on public.platform_staff
  for select using (id = auth.uid());

grant select on public.platform_staff to authenticated;
grant all on public.platform_staff to service_role;

-- Helper: is current JWT user an active platform staff member?
create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_staff
    where id = auth.uid() and is_active = true
  );
$$;

grant execute on function public.is_platform_staff() to authenticated, service_role;

-- Platform staff may list/update all tenants (ops console)
drop policy if exists tenants_platform_select on public.tenants;
create policy tenants_platform_select on public.tenants
  for select using (public.is_platform_staff());

drop policy if exists tenants_platform_update on public.tenants;
create policy tenants_platform_update on public.tenants
  for update using (public.is_platform_staff())
  with check (public.is_platform_staff());

-- Platform staff may list all profiles (read-only overview)
drop policy if exists profiles_platform_select on public.profiles;
create policy profiles_platform_select on public.profiles
  for select using (public.is_platform_staff());
