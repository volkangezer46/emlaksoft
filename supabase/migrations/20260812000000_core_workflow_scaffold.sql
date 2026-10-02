-- Schema-only scaffold for the core workflow reconciliation cut-over.
--
-- This deliberately installs no trigger, policy or lifecycle behaviour.  It
-- gives operators durable linkage fields first, so historical rows can be
-- reconciled and audited before the fail-closed invariant migration runs.

alter table public.deals
  add column if not exists prev_property_status text,
  add column if not exists project_unit_id uuid,
  add column if not exists closure_active boolean not null default false;

alter table public.rentals
  add column if not exists deal_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deals'::regclass
      and conname = 'deals_project_unit_tenant_fkey'
  ) then
    alter table public.deals
      add constraint deals_project_unit_tenant_fkey
      foreign key (project_unit_id, tenant_id)
      references public.project_units(id, tenant_id)
      on delete restrict
      not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rentals'::regclass
      and conname = 'rentals_deal_tenant_fkey'
  ) then
    alter table public.rentals
      add constraint rentals_deal_tenant_fkey
      foreign key (deal_id, tenant_id)
      references public.deals(id, tenant_id)
      on delete restrict
      not valid;
  end if;
end;
$$;

alter table public.deals validate constraint deals_project_unit_tenant_fkey;
alter table public.rentals validate constraint rentals_deal_tenant_fkey;

comment on column public.deals.closure_active is
  'True only while the won deal owns the property closure; reconciled before atomic workflow enforcement.';
comment on column public.deals.prev_property_status is
  'Last non-terminal property status captured by the canonical close workflow for an exact reopen.';
comment on column public.deals.project_unit_id is
  'Project inventory sale provenance; populated before project sale invariants are enabled.';
comment on column public.rentals.deal_id is
  'Won rent-deal/commission provenance; populated before rental lifecycle invariants are enabled.';
