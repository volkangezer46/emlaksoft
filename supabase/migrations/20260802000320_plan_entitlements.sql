-- Plan entitlements are enforced in the database so direct PostgREST, imports,
-- service jobs and Server Actions cannot create records beyond paid capacity.

create table if not exists public.plan_entitlements (
  plan text primary key check (plan in ('advisor', 'office', 'professional', 'enterprise')),
  seat_limit integer check (seat_limit is null or seat_limit > 0),
  customer_limit integer check (customer_limit is null or customer_limit > 0),
  active_property_limit integer check (active_property_limit is null or active_property_limit > 0),
  branch_limit integer check (branch_limit is null or branch_limit > 0),
  updated_at timestamptz not null default now()
);

insert into public.plan_entitlements (plan, seat_limit, customer_limit, active_property_limit, branch_limit)
values
  ('advisor', 1, 1000, 150, 1),
  ('office', 5, null, null, 3),
  ('professional', 20, null, null, 10),
  ('enterprise', 50, null, null, null)
on conflict (plan) do update set
  seat_limit = excluded.seat_limit,
  customer_limit = excluded.customer_limit,
  active_property_limit = excluded.active_property_limit,
  branch_limit = excluded.branch_limit,
  updated_at = now();

alter table public.plan_entitlements enable row level security;
revoke all on public.plan_entitlements from anon, authenticated;
grant select on public.plan_entitlements to service_role;

create index if not exists idx_profiles_active_tenant
  on public.profiles (tenant_id) where is_active = true;
create index if not exists idx_customers_live_tenant
  on public.customers (tenant_id) where deleted_at is null;
create index if not exists idx_properties_active_tenant
  on public.properties (tenant_id)
  where deleted_at is null and status in ('draft', 'live', 'reserved');
create index if not exists idx_branches_active_tenant
  on public.branches (tenant_id) where is_active = true;

create or replace function public.enforce_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant uuid;
  metric text;
  capacity integer;
  current_usage bigint;
  should_check boolean := false;
begin
  target_tenant := new.tenant_id;

  case tg_table_name
    when 'profiles' then
      metric := 'seats';
      should_check := new.is_active and (
        tg_op = 'INSERT' or not old.is_active or new.tenant_id is distinct from old.tenant_id
      );
    when 'customers' then
      metric := 'customers';
      should_check := new.deleted_at is null and (
        tg_op = 'INSERT' or old.deleted_at is not null or new.tenant_id is distinct from old.tenant_id
      );
    when 'properties' then
      metric := 'active_properties';
      should_check := new.deleted_at is null
        and new.status in ('draft', 'live', 'reserved')
        and (
          tg_op = 'INSERT'
          or old.deleted_at is not null
          or old.status not in ('draft', 'live', 'reserved')
          or new.tenant_id is distinct from old.tenant_id
      );
    when 'branches' then
      metric := 'branches';
      should_check := new.is_active and (
        tg_op = 'INSERT' or not old.is_active or new.tenant_id is distinct from old.tenant_id
      );
    else
      return new;
  end case;

  if not should_check then
    return new;
  end if;

  -- Serialize every capacity-changing operation for the tenant. A tenant-wide
  -- lock also makes concurrent plan downgrades and inserts observe one another.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-capacity:' || target_tenant::text, 0)
  );

  select case metric
    when 'seats' then pe.seat_limit
    when 'customers' then pe.customer_limit
    when 'active_properties' then pe.active_property_limit
    when 'branches' then pe.branch_limit
  end
  into capacity
  from public.tenants t
  join public.plan_entitlements pe on pe.plan = t.plan
  where t.id = target_tenant;

  if capacity is null then
    return new;
  end if;

  case metric
    when 'seats' then
      select count(*) into current_usage from public.profiles
      where tenant_id = target_tenant and is_active = true;
    when 'customers' then
      select count(*) into current_usage from public.customers
      where tenant_id = target_tenant and deleted_at is null;
    when 'active_properties' then
      select count(*) into current_usage from public.properties
      where tenant_id = target_tenant
        and deleted_at is null
        and status in ('draft', 'live', 'reserved');
    when 'branches' then
      select count(*) into current_usage from public.branches
      where tenant_id = target_tenant and is_active = true;
  end case;

  if current_usage >= capacity then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_LIMIT_EXCEEDED:' || metric || ':' || capacity::text;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_plan_capacity() from public, anon, authenticated;

create or replace function public.enforce_tenant_plan_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits record;
  current_usage bigint;
begin
  if new.plan is not distinct from old.plan then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-capacity:' || new.id::text, 0)
  );

  select
    pe.seat_limit,
    pe.customer_limit,
    pe.active_property_limit,
    pe.branch_limit
  into limits
  from public.plan_entitlements pe
  where pe.plan = new.plan;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_ENTITLEMENT_NOT_FOUND:' || new.plan;
  end if;

  if limits.seat_limit is not null then
    select count(*) into current_usage
    from public.profiles
    where tenant_id = new.id and is_active = true;
    if current_usage > limits.seat_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:seats:' || limits.seat_limit::text;
    end if;
  end if;

  if limits.customer_limit is not null then
    select count(*) into current_usage
    from public.customers
    where tenant_id = new.id and deleted_at is null;
    if current_usage > limits.customer_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:customers:' || limits.customer_limit::text;
    end if;
  end if;

  if limits.active_property_limit is not null then
    select count(*) into current_usage
    from public.properties
    where tenant_id = new.id
      and deleted_at is null
      and status in ('draft', 'live', 'reserved');
    if current_usage > limits.active_property_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:active_properties:' || limits.active_property_limit::text;
    end if;
  end if;

  if limits.branch_limit is not null then
    select count(*) into current_usage
    from public.branches
    where tenant_id = new.id and is_active = true;
    if current_usage > limits.branch_limit then
      raise exception using
        errcode = 'P0001',
        message = 'PLAN_LIMIT_EXCEEDED:branches:' || limits.branch_limit::text;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_tenant_plan_capacity() from public, anon, authenticated;

drop trigger if exists trg_tenants_plan_capacity on public.tenants;
create trigger trg_tenants_plan_capacity
before update of plan on public.tenants
for each row execute function public.enforce_tenant_plan_capacity();

drop trigger if exists trg_profiles_plan_capacity on public.profiles;
create trigger trg_profiles_plan_capacity
before insert or update of tenant_id, is_active on public.profiles
for each row execute function public.enforce_plan_capacity();

drop trigger if exists trg_customers_plan_capacity on public.customers;
create trigger trg_customers_plan_capacity
before insert or update of tenant_id, deleted_at on public.customers
for each row execute function public.enforce_plan_capacity();

drop trigger if exists trg_properties_plan_capacity on public.properties;
create trigger trg_properties_plan_capacity
before insert or update of tenant_id, deleted_at, status on public.properties
for each row execute function public.enforce_plan_capacity();

drop trigger if exists trg_branches_plan_capacity on public.branches;
create trigger trg_branches_plan_capacity
before insert or update of tenant_id, is_active on public.branches
for each row execute function public.enforce_plan_capacity();

comment on table public.plan_entitlements is
  'Authoritative paid capacity limits. Keep in sync with src/lib/billing/plans.ts.';
