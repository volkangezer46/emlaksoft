-- Core tenant relationship boundaries.
--
-- RLS validates the child row's tenant_id, but a globally keyed parent UUID
-- could otherwise belong to another tenant. Composite foreign keys make the
-- parent/child tenant invariant structural for appointments, offers, tasks and
-- contracts. Composite constraints mirror each existing relationship's delete
-- behavior so the ownership guard never turns a previous SET NULL/CASCADE into
-- an accidental delete blocker. SET NULL names only the parent UUID column;
-- tenant_id remains non-null and unchanged (PostgreSQL 15+ column-list form).
--
-- NOT VALID protects rollout from a long initial table lock while still
-- enforcing every new write immediately. VALIDATE then proves all historical
-- rows before this migration can commit.

create unique index if not exists idx_customers_id_tenant_unique
  on public.customers(id, tenant_id);
create unique index if not exists idx_properties_id_tenant_unique
  on public.properties(id, tenant_id);
create unique index if not exists idx_profiles_id_tenant_unique
  on public.profiles(id, tenant_id);
create unique index if not exists idx_deals_id_tenant_unique
  on public.deals(id, tenant_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_customer_tenant_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete set null (customer_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_property_tenant_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete set null (property_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_assignee_tenant_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_assignee_tenant_fkey
      foreign key (assigned_to, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_creator_tenant_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.offers'::regclass
      and conname = 'offers_property_tenant_fkey'
  ) then
    alter table public.offers
      add constraint offers_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.offers'::regclass
      and conname = 'offers_customer_tenant_fkey'
  ) then
    alter table public.offers
      add constraint offers_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete set null (customer_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.offers'::regclass
      and conname = 'offers_creator_tenant_fkey'
  ) then
    alter table public.offers
      add constraint offers_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      on delete set null (created_by)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.offers'::regclass
      and conname = 'offers_deal_tenant_fkey'
  ) then
    alter table public.offers
      add constraint offers_deal_tenant_fkey
      foreign key (deal_id, tenant_id)
      references public.deals(id, tenant_id)
      on delete set null (deal_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_assignee_tenant_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_assignee_tenant_fkey
      foreign key (assigned_to, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_customer_tenant_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete set null (customer_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_property_tenant_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete set null (property_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_creator_tenant_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname = 'tasks_deal_tenant_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_deal_tenant_fkey
      foreign key (deal_id, tenant_id)
      references public.deals(id, tenant_id)
      on delete set null (deal_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_creator_tenant_fkey'
  ) then
    alter table public.contracts
      add constraint contracts_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      on delete set null (created_by)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_property_tenant_fkey'
  ) then
    alter table public.contracts
      add constraint contracts_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete set null (property_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and conname = 'contracts_customer_tenant_fkey'
  ) then
    alter table public.contracts
      add constraint contracts_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete set null (customer_id)
      not valid;
  end if;
end;
$$;

alter table public.appointments validate constraint appointments_customer_tenant_fkey;
alter table public.appointments validate constraint appointments_property_tenant_fkey;
alter table public.appointments validate constraint appointments_assignee_tenant_fkey;
alter table public.appointments validate constraint appointments_creator_tenant_fkey;

alter table public.offers validate constraint offers_property_tenant_fkey;
alter table public.offers validate constraint offers_customer_tenant_fkey;
alter table public.offers validate constraint offers_creator_tenant_fkey;
alter table public.offers validate constraint offers_deal_tenant_fkey;

alter table public.tasks validate constraint tasks_assignee_tenant_fkey;
alter table public.tasks validate constraint tasks_customer_tenant_fkey;
alter table public.tasks validate constraint tasks_property_tenant_fkey;
alter table public.tasks validate constraint tasks_creator_tenant_fkey;
alter table public.tasks validate constraint tasks_deal_tenant_fkey;

alter table public.contracts validate constraint contracts_creator_tenant_fkey;
alter table public.contracts validate constraint contracts_property_tenant_fkey;
alter table public.contracts validate constraint contracts_customer_tenant_fkey;
