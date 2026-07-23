-- Görevler / takip otomasyonu: follow-up, arama, ziyaret, evrak görevleri.
-- Follow Up Boss / Lofty "action plans" karşılığı — hiçbir lead/anlaşma unutulmaz.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  notes text,
  kind text not null default 'followup' check (kind in ('followup', 'call', 'visit', 'document', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_at timestamptz,
  assigned_to uuid references public.profiles(id),
  customer_id uuid references public.customers(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  created_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_tasks_tenant_status on public.tasks(tenant_id, status, due_at);
create index if not exists idx_tasks_assignee on public.tasks(tenant_id, assigned_to, status);
create index if not exists idx_tasks_customer on public.tasks(tenant_id, customer_id);

alter table public.tasks enable row level security;

drop policy if exists tasks_tenant on public.tasks;
create policy tasks_tenant on public.tasks for all
  using (tenant_id = (select auth.jwt()->>'tenant_id')::uuid);

grant all on public.tasks to authenticated, service_role;

-- Varsayılan izin matrisi ile senkron (bkz. src/lib/permissions.ts)
insert into public.permission_defaults (role, module, action)
select r, 'tasks', a
from (values ('owner'),('gm'),('branch_manager'),('team_lead')) as roles(r)
cross join (values ('view'),('create'),('edit'),('delete')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
select r, 'tasks', a
from (values ('advisor'),('call_center')) as roles(r)
cross join (values ('view'),('create'),('edit')) as acts(a)
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
values ('readonly', 'tasks', 'view')
on conflict do nothing;

comment on table public.tasks is
  'Görev / takip otomasyonu: follow-up, arama, ziyaret, evrak — müşteri/portföy/anlaşma bağlanabilir';
