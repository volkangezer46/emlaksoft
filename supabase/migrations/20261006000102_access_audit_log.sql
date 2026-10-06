-- Forward-only migration: Erişim yetki değişiklik denetim günlüğü.
-- Her yetki değişikliği loglanır: kim, ne zaman, ne değişti, neden.

create table if not exists public.access_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Değişiklik türü
  change_type text not null check (
    change_type in (
      'scope_created',
      'scope_updated',
      'scope_deleted',
      'override_created',
      'override_updated',
      'override_deleted',
      'permission_granted',
      'permission_revoked'
    )
  ),
  -- Değişiklik detayları (JSON)
  details jsonb not null default '{}',
  -- Nedenini belirtmek için not (müdür reddetti, vb)
  reason text,
  -- Yapan
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_access_audit_log_tenant on public.access_audit_log(tenant_id);
create index if not exists idx_access_audit_log_user on public.access_audit_log(user_id);
create index if not exists idx_access_audit_log_change_type on public.access_audit_log(change_type);
create index if not exists idx_access_audit_log_created on public.access_audit_log(created_at);

comment on table public.access_audit_log is
  'Erişim yetki değişikliklerinin denetim günlüğü. Her yetki değişimi kaydedilir: kim tarafından, ne zaman, ne değişti, neden.';

comment on column public.access_audit_log.details is
  'Değişiklik detayları (JSON). Örn: {"scope_type": "team", "team_id": "...", "old_value": "...", "new_value": "..."}';

alter table public.access_audit_log enable row level security;

-- RLS: Authenticated sadece okuş (detaylı loglama admin'e)
create policy access_audit_log_read on public.access_audit_log for select
  using (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'));

-- Service role yazabilir (triggers tarafından)
grant select on public.access_audit_log to authenticated;
grant all on public.access_audit_log to service_role;
