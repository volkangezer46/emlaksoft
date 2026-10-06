-- Navigation badge cache tablosu (5 dakikalık snapshot)
-- Amaç: nav badge sorgularını her sayfa yüklemesinde çalıştırmak yerine
-- arka plan cron'unun 5 dakikada bir yenileyen cache'den okuması

create table if not exists public.nav_badge_snapshots (
  tenant_id uuid not null references public.tenants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  computed_at timestamp with time zone not null default now(),
  overdue_tasks_count int not null default 0,
  pending_approvals_count int not null default 0,
  primary key (tenant_id, user_id),
  check (computed_at > now() - interval '10 minutes')
);

-- Her tenant-user çifti için en son snapshot'ı hızlıca getir
create or replace function public.get_nav_badge_snapshot(p_tenant_id uuid, p_user_id uuid)
returns table (overdue_tasks_count int, pending_approvals_count int, computed_at timestamp with time zone)
language sql
stable
security definer
set search_path = 'public'
as $$
  select nbs.overdue_tasks_count, nbs.pending_approvals_count, nbs.computed_at
  from nav_badge_snapshots nbs
  where nbs.tenant_id = p_tenant_id
    and nbs.user_id = p_user_id
    and nbs.computed_at > now() - interval '10 minutes'
  limit 1;
$$;

-- Cache yenileme RPC'si (cron tarafından çağrılır)
create or replace function public.refresh_nav_badge_snapshot(p_tenant_id uuid, p_user_id uuid)
returns table (overdue_tasks_count int, pending_approvals_count int)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_overdue_count int;
  v_pending_count int;
begin
  -- Geciken görevler (güncellenecek: burada `now()` saati zamanı, saat dilimi TR olmalı)
  select count(*) into v_overdue_count
  from tasks t
  where t.tenant_id = p_tenant_id
    and t.user_id = p_user_id
    and t.status = 'open'
    and t.due_at < now()::timestamp with time zone
    and t.deleted_at is null;

  -- Onay bekleyen talepler (talep yazarı değilse)
  select count(*) into v_pending_count
  from approval_requests ar
  where ar.tenant_id = p_tenant_id
    and ar.status = 'bekliyor'
    and ar.requested_by != p_user_id
    and ar.deleted_at is null;

  -- Cache güncelle ya da ekle
  insert into nav_badge_snapshots (tenant_id, user_id, computed_at, overdue_tasks_count, pending_approvals_count)
  values (p_tenant_id, p_user_id, now(), v_overdue_count, v_pending_count)
  on conflict (tenant_id, user_id) do update
  set computed_at = now(),
      overdue_tasks_count = v_overdue_count,
      pending_approvals_count = v_pending_count;

  return query select v_overdue_count, v_pending_count;
end;
$$;

-- RLS: yalnız kendi snapshot'ını oku (tenant izolasyonu)
alter table nav_badge_snapshots enable row level security;
create policy nav_badge_snapshots_select on nav_badge_snapshots for select
  using (tenant_id = public.current_tenant_id() and user_id = auth.uid());

-- Temizlik: 15 dakikadan eski snapshot'ları sil
create or replace function public.cleanup_stale_nav_badges()
returns integer
language sql
security definer
set search_path = 'public'
as $$
  delete from nav_badge_snapshots
  where computed_at < now() - interval '15 minutes';
  select changes()::int;
$$;

-- Cron için: son 30 günde etkin (görev/onay yazışması olan) kullanıcıları al
create or replace function public.get_active_users_for_nav_badges()
returns table (tenant_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = 'public'
as $$
  select distinct t.id as tenant_id, p.id as user_id
  from tenants t
  join profiles p on p.tenant_id = t.id and p.deleted_at is null
  where exists (
    select 1 from tasks
    where tasks.tenant_id = t.id
      and tasks.assigned_to = p.id
      and tasks.created_at > now() - interval '30 days'
  )
  or exists (
    select 1 from approval_requests
    where approval_requests.tenant_id = t.id
      and (approval_requests.requested_by = p.id or approval_requests.deleted_at is null)
      and approval_requests.created_at > now() - interval '30 days'
  )
  limit 10000;
$$;
