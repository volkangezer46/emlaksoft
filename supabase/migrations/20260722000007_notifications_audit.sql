-- Notifications + audit insert policy (Faz 1)

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  href text,
  kind text not null default 'info'
    check (kind in ('info','success','warning','danger','system')),
  read_at timestamptz,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(tenant_id, user_id, created_at desc);
create index if not exists idx_notifications_unread on public.notifications(tenant_id, user_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists notifications_tenant_select on public.notifications;
create policy notifications_tenant_select on public.notifications for select
  using (
    tenant_id = public.current_tenant_id()
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists notifications_tenant_update on public.notifications;
create policy notifications_tenant_update on public.notifications for update
  using (
    tenant_id = public.current_tenant_id()
    and (user_id is null or user_id = auth.uid())
  )
  with check (
    tenant_id = public.current_tenant_id()
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists notifications_tenant_insert on public.notifications;
create policy notifications_tenant_insert on public.notifications for insert
  with check (tenant_id = public.current_tenant_id());

grant select, insert, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- Allow authenticated tenants to write their own audit rows
drop policy if exists audit_tenant_insert on public.audit_logs;
create policy audit_tenant_insert on public.audit_logs for insert
  with check (tenant_id = public.current_tenant_id());
