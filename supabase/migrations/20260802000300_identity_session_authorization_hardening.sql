-- Identity, session and authorization hardening.
-- Forward-only: previous (including untracked development) migrations remain immutable.

-- ---------------------------------------------------------------------------
-- Versioned custom SMS 2FA evidence
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists two_factor_version integer not null default 1;

-- Registration provisioning already creates the tenant/profile/subscription/
-- consent atomically. Keep the new Auth user's tenant and role claims in that
-- same database transaction: an AFTER INSERT failure rolls the whole RPC back.
create or replace function public.sync_inserted_profile_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Profile creation requires the trusted server workflow.'
      using errcode = '42501';
  end if;

  update auth.users u
  set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'tenant_id', new.tenant_id::text,
      'role', new.role,
      'account_active', new.is_active,
      'deactivated_at', case when new.is_active then null else now() end
    )
  where u.id = new.id;

  if not found then
    raise exception 'Auth user not found for profile.' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke all privileges on function public.sync_inserted_profile_auth_identity()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_profiles_sync_auth_identity_insert on public.profiles;
create trigger trg_profiles_sync_auth_identity_insert
after insert on public.profiles
for each row execute function public.sync_inserted_profile_auth_identity();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_two_factor_version_positive'
  ) then
    alter table public.profiles
      add constraint profiles_two_factor_version_positive
      check (two_factor_version > 0);
  end if;
end;
$$;

create or replace function public.bump_profile_two_factor_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.two_factor_sms is distinct from old.two_factor_sms
    or new.phone is distinct from old.phone then
    new.two_factor_version := old.two_factor_version + 1;
  end if;
  return new;
end;
$$;

revoke all privileges on function public.bump_profile_two_factor_version()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_profiles_two_factor_version on public.profiles;
create trigger trg_profiles_two_factor_version
before update of two_factor_sms, phone on public.profiles
for each row execute function public.bump_profile_two_factor_version();

-- Identity fields must be changed by the service-role orchestration path so
-- Auth claims, ban state and sessions cannot drift from the canonical profile.
create or replace function public.guard_profile_identity_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() in ('anon', 'authenticated') and (
    new.tenant_id is distinct from old.tenant_id
    or new.branch_id is distinct from old.branch_id
    or new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.two_factor_sms is distinct from old.two_factor_sms
    or (
      new.two_factor_version is distinct from old.two_factor_version
      and new.phone is not distinct from old.phone
      and new.two_factor_sms is not distinct from old.two_factor_sms
    )
  ) then
    raise exception 'Identity fields require the trusted server workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all privileges on function public.guard_profile_identity_fields()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_profile_role_change on public.profiles;
drop trigger if exists trg_guard_profile_identity_fields on public.profiles;
create trigger trg_guard_profile_identity_fields
before update on public.profiles
for each row execute function public.guard_profile_identity_fields();

-- Cookie is an application/UI gate, but PostgREST cannot see it. Keep a
-- matching service-written session proof so RLS can enforce custom SMS 2FA too.
create table if not exists public.two_factor_verified_sessions (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_version integer not null check (profile_version > 0),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint two_factor_verified_session_id_nonempty
    check (char_length(btrim(session_id)) between 1 and 256),
  constraint two_factor_verified_expiry_order
    check (expires_at > verified_at)
);

create index if not exists idx_two_factor_verified_sessions_user
  on public.two_factor_verified_sessions(user_id, expires_at);

alter table public.two_factor_verified_sessions enable row level security;
revoke all privileges on table public.two_factor_verified_sessions
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.two_factor_verified_sessions
  to service_role;

create or replace function public.current_session_two_factor_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select
        not coalesce(p.two_factor_sms, false)
        or exists (
          select 1
          from public.two_factor_verified_sessions v
          where v.session_id = nullif(btrim(auth.jwt() ->> 'session_id'), '')
            and v.user_id = auth.uid()
            and v.profile_version = p.two_factor_version
            and v.expires_at > now()
        )
      from public.profiles p
      where p.id = auth.uid() and p.is_active = true
      limit 1
    ),
    true
  );
$$;

revoke all privileges on function public.current_session_two_factor_satisfied()
  from public, anon, authenticated, service_role;
grant execute on function public.current_session_two_factor_satisfied()
  to authenticated, service_role;

-- The snapshot table must exist before the canonical tenant helper below is
-- compiled because that helper validates the impersonating session against it.
create table if not exists public.platform_impersonation_sessions (
  staff_id uuid primary key references public.platform_staff(id) on delete cascade,
  auth_session_id text not null,
  target_tenant_id uuid not null references public.tenants(id) on delete cascade,
  original_app_metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint platform_impersonation_session_id_nonempty
    check (char_length(btrim(auth_session_id)) between 1 and 256),
  constraint platform_impersonation_expiry_order
    check (expires_at > started_at)
);

create index if not exists idx_platform_impersonation_sessions_expiry
  on public.platform_impersonation_sessions(expires_at);

alter table public.platform_impersonation_sessions enable row level security;
revoke all privileges on table public.platform_impersonation_sessions
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.platform_impersonation_sessions
  to service_role;

-- ---------------------------------------------------------------------------
-- Canonical active identity helpers
-- ---------------------------------------------------------------------------

create or replace function public.current_active_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.tenant_id
      from public.profiles p
      join public.tenants t on t.id = p.tenant_id
      where p.id = auth.uid()
        and p.is_active = true
        and t.status not in ('suspended', 'cancelled')
        and p.tenant_id::text = nullif(
          btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'),
          ''
        )
        and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
        and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
        and public.current_session_two_factor_satisfied()
      limit 1
    ),
    (
      select t.id
      from public.platform_staff ps
      join public.tenants t
        on t.id::text = nullif(
          btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'),
          ''
        )
      where ps.id = auth.uid()
        and ps.is_active = true
        and auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
        and auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'
        and nullif(
          btrim(auth.jwt() -> 'app_metadata' ->> 'impersonation_session_id'),
          ''
        ) = nullif(btrim(auth.jwt() ->> 'session_id'), '')
        and exists (
          select 1
          from public.platform_impersonation_sessions pis
          where pis.staff_id = auth.uid()
            and pis.auth_session_id = nullif(btrim(auth.jwt() ->> 'session_id'), '')
            and pis.target_tenant_id = t.id
            and pis.expires_at > now()
        )
        and t.status not in ('suspended', 'cancelled')
        and public.current_session_two_factor_satisfied()
      limit 1
    )
  );
$$;

comment on function public.current_active_tenant_id() is
  'Canonical tenant only for an active matching profile or active readonly platform impersonation, and never for suspended/cancelled tenants.';

revoke all privileges on function public.current_active_tenant_id()
  from public, anon, authenticated, service_role;
grant execute on function public.current_active_tenant_id()
  to authenticated, service_role;

-- Preserve the long-standing helper signature used by policies throughout the
-- schema, but remove its raw-JWT behavior. Existing dependencies now inherit
-- the same active profile, tenant lifecycle, 2FA and impersonation checks.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_active_tenant_id();
$$;

comment on function public.current_tenant_id() is
  'Compatibility helper delegating to the canonical active tenant boundary.';

revoke all privileges on function public.current_tenant_id()
  from public, anon, authenticated, service_role;
grant execute on function public.current_tenant_id()
  to anon, authenticated, service_role;

create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_staff ps
    where ps.id = auth.uid()
      and ps.is_active = true
      and coalesce(
        auth.jwt() -> 'app_metadata' ->> 'impersonating',
        'false'
      ) <> 'true'
  );
$$;

revoke all privileges on function public.is_platform_staff()
  from public, anon, authenticated, service_role;
grant execute on function public.is_platform_staff()
  to anon, authenticated, service_role;

-- A number of legacy public-intake policies are intentionally role-agnostic
-- and OR their anonymous predicate with is_platform_staff(). Anonymous callers
-- must be able to evaluate the helper to false instead of failing the entire
-- policy with a function-permission error. SECURITY DEFINER plus auth.uid()
-- keeps this a boolean identity check; it exposes no platform rows.

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.role
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = public.current_active_tenant_id()
        and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
      limit 1
    ),
    case
      when public.current_active_tenant_id() is not null
        and auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
        and auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'
      then 'readonly'
    end,
    ''
  );
$$;

revoke all privileges on function public.current_profile_role()
  from public, anon, authenticated, service_role;
grant execute on function public.current_profile_role()
  to authenticated, service_role;

-- has_effective_permission is SECURITY INVOKER and therefore needs explicit
-- read access to the immutable permission matrix at policy evaluation time.
revoke all privileges on table public.permission_defaults
  from public, anon, authenticated, service_role;
grant select on table public.permission_defaults
  to authenticated, service_role;

create or replace function public.has_effective_permission(
  p_module text,
  p_action text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.current_active_tenant_id() is not null
    and case
      -- Readonly is an immutable ceiling for support impersonation. Neither a
      -- tenant role override nor a cross-tenant user override may add writes.
      when public.current_profile_role() = 'readonly' then
        p_action = 'view'
        and exists (
          select 1
          from public.permission_defaults pd
          where pd.role = 'readonly'
            and pd.module = p_module
            and pd.action = 'view'
        )
      else coalesce(
        case
          when public.current_profile_role() <> 'owner' then (
            select p_action = any(u.actions)
            from public.user_permission_overrides u
            where u.tenant_id = public.current_active_tenant_id()
              and u.user_id = auth.uid()
              and u.module = p_module
              and (u.expires_at is null or u.expires_at > now())
            limit 1
          )
        end,
        (
          select trp.allowed
          from public.tenant_role_permissions trp
          where trp.tenant_id = public.current_active_tenant_id()
            and trp.role = public.current_profile_role()
            and trp.module = p_module
            and trp.action = p_action
          limit 1
        ),
        exists (
          select 1
          from public.permission_defaults pd
          where pd.role = public.current_profile_role()
            and pd.module = p_module
            and pd.action = p_action
        ),
        false
      )
    end;
$$;

revoke all privileges on function public.has_effective_permission(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.has_effective_permission(text, text)
  to authenticated, service_role;

-- Legacy tables still carry broad FOR ALL tenant policies. Every canonical
-- readonly identity (tenant role or support impersonation) may select through
-- current_tenant_id(), but must never mutate an application table regardless
-- of old policy shape. Service-role orchestration remains unaffected.
create or replace function public.block_readonly_identity_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated'
    and (
      auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
      or public.current_profile_role() = 'readonly'
      or auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.is_active = true
          and p.role = 'readonly'
      )
    ) then
    raise exception 'Readonly identities cannot mutate application data.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all privileges on function public.block_readonly_identity_writes()
  from public, anon, authenticated, service_role;

do $$
declare
  v_table record;
begin
  for v_table in
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and not exists (
        select 1
        from pg_catalog.pg_depend d
        join pg_catalog.pg_extension e on e.oid = d.refobjid
        where d.classid = 'pg_catalog.pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
      )
  loop
    execute format(
      'drop trigger if exists trg_block_readonly_identity_writes on public.%I',
      v_table.table_name
    );
    execute format(
      'create trigger trg_block_readonly_identity_writes before insert or update or delete on public.%I for each row execute function public.block_readonly_identity_writes()',
      v_table.table_name
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trusted team deactivation: physically revoke refresh/session state
-- ---------------------------------------------------------------------------

create or replace function public.revoke_team_member_sessions(
  p_user_id uuid,
  p_tenant_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_user_id is null or p_tenant_id is null or not exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.tenant_id = p_tenant_id
      and p.is_active = false
  ) then
    raise exception 'Inactive tenant member not found.' using errcode = '42501';
  end if;

  delete from public.login_challenges where user_id = p_user_id;
  delete from public.two_factor_verified_sessions where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all privileges on function public.revoke_team_member_sessions(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_team_member_sessions(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Tenant row and profile policies
-- ---------------------------------------------------------------------------

-- Tenant administrators may edit ordinary company/branding/settings fields,
-- but subscription and lifecycle identity is service-controlled. This blocks
-- direct PostgREST plan upgrades or status/trial manipulation.
create or replace function public.guard_tenant_lifecycle_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() in ('anon', 'authenticated') and (
    new.id is distinct from old.id
    or new.slug is distinct from old.slug
    or new.plan is distinct from old.plan
    or new.status is distinct from old.status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.team_size is distinct from old.team_size
    or new.created_at is distinct from old.created_at
    or new.lead_capture_token is distinct from old.lead_capture_token
    or new.sample_seeded_at is distinct from old.sample_seeded_at
  ) then
    raise exception 'Tenant lifecycle fields require the trusted server workflow.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all privileges on function public.guard_tenant_lifecycle_fields()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_tenant_lifecycle_fields on public.tenants;
create trigger trg_guard_tenant_lifecycle_fields
before update on public.tenants
for each row execute function public.guard_tenant_lifecycle_fields();

-- A branch UUID alone does not prove tenant ownership. Composite NOT VALID
-- foreign keys protect every new/updated row immediately while allowing a
-- later audited cleanup before legacy rows are validated.
create unique index if not exists idx_branches_id_tenant_unique
  on public.branches(id, tenant_id);
create unique index if not exists idx_profiles_id_tenant_unique
  on public.profiles(id, tenant_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_branch_tenant_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_branch_tenant_fkey
      foreign key (branch_id, tenant_id)
      references public.branches(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_branch_tenant_fkey'
  ) then
    alter table public.customers
      add constraint customers_branch_tenant_fkey
      foreign key (branch_id, tenant_id)
      references public.branches(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.properties'::regclass
      and conname = 'properties_branch_tenant_fkey'
  ) then
    alter table public.properties
      add constraint properties_branch_tenant_fkey
      foreign key (branch_id, tenant_id)
      references public.branches(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_branch_tenant_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_branch_tenant_fkey
      foreign key (branch_id, tenant_id)
      references public.branches(id, tenant_id)
      not valid;
  end if;
end;
$$;

-- User-specific permission rows must reference a profile from the same tenant.
-- NOT VALID avoids blocking rollout on legacy drift while still enforcing all
-- new and updated rows immediately.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_permission_overrides'::regclass
      and conname = 'user_permission_overrides_user_tenant_fkey'
  ) then
    alter table public.user_permission_overrides
      add constraint user_permission_overrides_user_tenant_fkey
      foreign key (user_id, tenant_id)
      references public.profiles(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_permission_overrides'::regclass
      and conname = 'user_permission_overrides_creator_tenant_fkey'
  ) then
    alter table public.user_permission_overrides
      add constraint user_permission_overrides_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;
end;
$$;

drop policy if exists tenants_select on public.tenants;
drop policy if exists tenants_platform_select on public.tenants;
drop policy if exists tenants_platform_update on public.tenants;
drop policy if exists identity_tenants_select on public.tenants;
drop policy if exists identity_tenants_update on public.tenants;

create policy identity_tenants_select on public.tenants
for select to authenticated
using (
  (
    id::text = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = tenants.id
        and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
    )
  )
  or id = public.current_active_tenant_id()
  or (
    public.is_platform_staff()
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  )
);

create policy identity_tenants_update on public.tenants
for update to authenticated
using (
  (id = public.current_active_tenant_id() and public.has_effective_permission('settings', 'edit'))
  or (
    public.is_platform_staff()
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  )
)
with check (
  (id = public.current_active_tenant_id() and public.has_effective_permission('settings', 'edit'))
  or (
    public.is_platform_staff()
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
  )
);

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', v_policy.policyname);
  end loop;
end;
$$;

create policy identity_profiles_self_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  and is_active = true
  and (
    tenant_id::text = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')
    or exists (
      select 1
      from public.platform_staff ps
      where ps.id = auth.uid() and ps.is_active = true
    )
  )
);

-- Profile names are operational reference data across CRM modules. Active
-- tenant membership is still mandatory; writes remain separately authorized.
create policy identity_profiles_tenant_select on public.profiles
for select to authenticated
using (tenant_id = public.current_active_tenant_id());

create policy identity_profiles_platform_select on public.profiles
for select to authenticated
using (
  public.is_platform_staff()
  and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
);

create policy identity_profiles_self_update on public.profiles
for update to authenticated
using (id = auth.uid() and tenant_id = public.current_active_tenant_id())
with check (id = auth.uid() and tenant_id = public.current_active_tenant_id());

create policy identity_profiles_team_insert on public.profiles
for insert to authenticated
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('team', 'create')
);

create policy identity_profiles_team_update on public.profiles
for update to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('team', 'edit')
)
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('team', 'edit')
);

create policy identity_profiles_team_delete on public.profiles
for delete to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('team', 'delete')
);

-- ---------------------------------------------------------------------------
-- Sensitive tenant core: active identity + module/action permission
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
  v_module text;
  v_policy record;
begin
  for v_table, v_module in
    select * from (values
      ('customers', 'customers'),
      ('customer_demands', 'demands'),
      ('properties', 'properties'),
      ('portal_listings', 'portals'),
      ('deals', 'commissions'),
      ('calls', 'calls'),
      ('appointments', 'appointments'),
      ('tasks', 'tasks'),
      ('offers', 'offers'),
      ('contracts', 'contracts'),
      ('expenses', 'expenses'),
      ('communications', 'customers'),
      ('campaigns', 'campaigns'),
      ('rentals', 'rentals'),
      ('projects', 'projects'),
      ('iys_consents', 'compliance')
    ) as policy_map(table_name, module_name)
  loop
    execute format('alter table public.%I enable row level security', v_table);

    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        v_policy.policyname,
        v_table
      );
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission(%L, ''view''))',
      'identity_' || v_table || '_select', v_table, v_module
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission(%L, ''create''))',
      'identity_' || v_table || '_insert', v_table, v_module
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission(%L, ''edit'')) with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission(%L, ''edit''))',
      'identity_' || v_table || '_update', v_table, v_module, v_module
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission(%L, ''delete''))',
      'identity_' || v_table || '_delete', v_table, v_module
    );
  end loop;
end;
$$;

-- Branches are cross-module reference data, so active tenant members may
-- read them; team permissions still gate every mutation.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'branches'
  loop
    execute format('drop policy if exists %I on public.branches', v_policy.policyname);
  end loop;
end;
$$;

create policy identity_branches_select on public.branches
for select to authenticated
using (tenant_id = public.current_active_tenant_id());

create policy identity_branches_insert on public.branches
for insert to authenticated
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('team', 'create')
);

create policy identity_branches_update on public.branches
for update to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('team', 'edit')
)
with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('team', 'edit')
);

create policy identity_branches_delete on public.branches
for delete to authenticated
using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('team', 'delete')
);

-- ---------------------------------------------------------------------------
-- Atomic platform billing administration
-- ---------------------------------------------------------------------------

create or replace function public.update_tenant_plan_subscription(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_plan text,
  p_status text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old_plan text;
  v_old_status text;
  v_tenant_slug text;
  v_next_plan text;
  v_next_status text;
  v_subscription_status text;
  v_amount_try numeric;
  v_subscription_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_tenant_id is null then
    raise exception 'Tenant is required.' using errcode = '22023';
  end if;
  if p_actor_id is null or not exists (
    select 1
    from public.platform_staff ps
    where ps.id = p_actor_id
      and ps.is_active = true
      and ps.role in ('super_admin', 'billing')
  ) then
    raise exception 'Active billing staff required.' using errcode = '42501';
  end if;
  if nullif(btrim(p_plan), '') is not null
    and btrim(p_plan) not in ('advisor', 'office', 'professional', 'enterprise') then
    raise exception 'Invalid plan.' using errcode = '22023';
  end if;
  if nullif(btrim(p_status), '') is not null
    and btrim(p_status) not in ('trial', 'active', 'past_due', 'suspended', 'cancelled') then
    raise exception 'Invalid tenant status.' using errcode = '22023';
  end if;

  select t.plan, t.status, t.slug
    into v_old_plan, v_old_status, v_tenant_slug
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant not found.' using errcode = 'P0002';
  end if;

  v_next_plan := coalesce(nullif(btrim(p_plan), ''), v_old_plan);
  v_next_status := coalesce(nullif(btrim(p_status), ''), v_old_status);
  v_subscription_status := case v_next_status
    when 'trial' then 'trialing'
    when 'active' then 'active'
    when 'past_due' then 'past_due'
    when 'cancelled' then 'cancelled'
    else 'paused'
  end;
  v_amount_try := case v_next_plan
    when 'advisor' then 990
    when 'office' then 2490
    when 'professional' then 5990
    when 'enterprise' then 12900
  end;

  update public.tenants
  set plan = v_next_plan,
      status = v_next_status,
      updated_at = now()
  where id = p_tenant_id;

  update public.subscriptions
  set plan = v_next_plan,
      status = v_subscription_status,
      amount_try = v_amount_try,
      cancelled_at = case
        when v_subscription_status = 'cancelled' then coalesce(cancelled_at, now())
        else null
      end,
      updated_at = now()
  where tenant_id = p_tenant_id;
  get diagnostics v_subscription_count = row_count;

  if v_subscription_count <> 1 then
    raise exception 'Tenant subscription not found.' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  ) values (
    p_tenant_id,
    p_actor_id,
    'billing.tenant_plan_status',
    'tenant',
    p_tenant_id,
    jsonb_build_object('plan', v_old_plan, 'status', v_old_status),
    jsonb_build_object(
      'plan', v_next_plan,
      'status', v_next_status,
      'subscription_status', v_subscription_status,
      'monthly_amount_try', v_amount_try
    )
  );

  return jsonb_build_object(
    'tenantId', p_tenant_id::text,
    'tenantSlug', v_tenant_slug,
    'previousPlan', v_old_plan,
    'previousStatus', v_old_status,
    'plan', v_next_plan,
    'status', v_next_status,
    'subscriptionStatus', v_subscription_status,
    'monthlyAmountTry', v_amount_try
  );
end;
$$;

comment on function public.update_tenant_plan_subscription(uuid, uuid, text, text) is
  'Service-role-only atomic tenant lifecycle, canonical monthly subscription and audit update.';

revoke all privileges on function public.update_tenant_plan_subscription(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_tenant_plan_subscription(uuid, uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
