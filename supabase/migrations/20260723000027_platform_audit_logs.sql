-- Platform personel işlemleri için audit tablosu.
-- tenant_id yok; platform-seviyesi (super_admin, ops, vb.) işlemleri kaydeder.

create table if not exists public.platform_audit_logs (
  id          uuid        primary key default gen_random_uuid(),
  actor_id    uuid        references public.platform_staff(id) on delete set null,
  action      text        not null,
  entity_type text,
  entity_id   uuid,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_platform_audit_created
  on public.platform_audit_logs(created_at desc);

create index if not exists idx_platform_audit_actor
  on public.platform_audit_logs(actor_id, created_at desc);

-- RLS: sadece platform_staff okuyabilir (service_role insert eder)
alter table public.platform_audit_logs enable row level security;

drop policy if exists platform_audit_read on public.platform_audit_logs;
create policy platform_audit_read on public.platform_audit_logs
  for select
  using (
    exists (
      select 1 from public.platform_staff ps
      where ps.id = auth.uid() and ps.is_active = true
    )
  );

grant select on public.platform_audit_logs to authenticated;
grant all    on public.platform_audit_logs to service_role;
