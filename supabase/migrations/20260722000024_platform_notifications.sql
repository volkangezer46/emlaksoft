-- Platform (EmlakSoft personeli) bildirim merkezi.
-- Tenant'a bağlı `notifications`'tan ayrı: bu tablo platform_staff'a fan-out edilir,
-- her personelin kendi okundu durumu olur. Demo talebi, ticket, risk uyarıları buraya düşer.

create table if not exists public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.platform_staff(id) on delete cascade,
  title text not null,
  body text,
  href text,
  kind text not null default 'info'
    check (kind in ('info','success','warning','danger','system')),
  read_at timestamptz,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_notifications_staff
  on public.platform_notifications(staff_id, created_at desc);
create index if not exists idx_platform_notifications_unread
  on public.platform_notifications(staff_id) where read_at is null;

alter table public.platform_notifications enable row level security;

drop policy if exists platform_notifications_self on public.platform_notifications;
create policy platform_notifications_self on public.platform_notifications
  for all
  using (staff_id = auth.uid())
  with check (staff_id = auth.uid());

grant select, update on public.platform_notifications to authenticated;
grant all on public.platform_notifications to service_role;

comment on table public.platform_notifications is
  'EmlakSoft personeli bildirim merkezi (fan-out; her staff kendi okundu durumu)';
