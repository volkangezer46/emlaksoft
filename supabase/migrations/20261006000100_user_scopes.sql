-- Forward-only migration: Kullanıcı kapsam (scope) sisteminin temeli.
-- Danışmanlar, takım liderleri, şube müdürleri için hiyerarşik erişim kontrol.
-- RLS: Ofis sahibi/gm yönetir; kullanıcılar kendi kapsamını okur.

create table if not exists public.user_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope_type text not null check (scope_type in ('user', 'team', 'branch', 'office', 'platform')),
  -- Scope bağlamı: team_lead için team_id, branch_manager için branch_id
  team_id uuid references public.teams(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  -- Yetkiler
  can_view_all_data boolean not null default false,
  can_edit_team_members boolean not null default false,
  can_override_permissions boolean not null default false,
  can_see_earnings boolean not null default false,
  -- Denetim
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists idx_user_scopes_tenant_user on public.user_scopes(tenant_id, user_id);
create index if not exists idx_user_scopes_team on public.user_scopes(team_id);
create index if not exists idx_user_scopes_branch on public.user_scopes(branch_id);

comment on table public.user_scopes is
  'Kullanıcı kapsam tanımları. Her kullanıcı bir scope_type''e sahip: user (danışman), team (takım lideri), branch (şube müdürü), office (ofis yönetim), platform (super_admin).';

comment on column public.user_scopes.scope_type is
  'Kapsam türü: user (kendi verileri), team (takım verileri), branch (şube verileri), office (ofis), platform (super_admin)';

comment on column public.user_scopes.team_id is
  'Takım IDsi (team_lead için doldurulur)';

comment on column public.user_scopes.branch_id is
  'Şube IDsi (branch_manager için doldurulur)';

comment on column public.user_scopes.can_view_all_data is
  'true = tüm ofis verisini görüntüleme yetkisi (owner/gm)';

comment on column public.user_scopes.can_edit_team_members is
  'true = takım üyelerini düzenleme yetkisi (team_lead ve üstü)';

alter table public.user_scopes enable row level security;

-- RLS: Authenticated kullanıcı kendi kapsamını okur
create policy user_scopes_read on public.user_scopes for select
  using (tenant_id = public.current_tenant_id());

-- RLS: Sadece owner/gm yazabilir
create policy user_scopes_write on public.user_scopes for all
  using (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'))
  with check (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'));

grant select on public.user_scopes to authenticated;
grant all on public.user_scopes to service_role;
