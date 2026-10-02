-- Capability/token tenant-boundary hardening.
--
-- A tenant-owned capability must never point at a parent row owned by another
-- tenant. Composite foreign keys enforce that invariant for all future writes;
-- NOT VALID keeps deployment non-destructive when legacy rows need quarantine.

create unique index if not exists idx_deals_id_tenant_unique
  on public.deals(id, tenant_id);
create unique index if not exists idx_referral_links_id_tenant_unique
  on public.referral_links(id, tenant_id);
create unique index if not exists idx_open_houses_id_tenant_unique
  on public.open_houses(id, tenant_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_portal_tokens'::regclass
      and conname = 'customer_portal_tokens_customer_tenant_fkey'
  ) then
    alter table public.customer_portal_tokens
      add constraint customer_portal_tokens_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.customer_portal_tokens'::regclass
      and conname = 'customer_portal_tokens_creator_tenant_fkey'
  ) then
    alter table public.customer_portal_tokens
      add constraint customer_portal_tokens_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.owner_portal_tokens'::regclass
      and conname = 'owner_portal_tokens_property_tenant_fkey'
  ) then
    alter table public.owner_portal_tokens
      add constraint owner_portal_tokens_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.owner_portal_tokens'::regclass
      and conname = 'owner_portal_tokens_creator_tenant_fkey'
  ) then
    alter table public.owner_portal_tokens
      add constraint owner_portal_tokens_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.valuations'::regclass
      and conname = 'valuations_property_tenant_fkey'
  ) then
    alter table public.valuations
      add constraint valuations_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.valuations'::regclass
      and conname = 'valuations_creator_tenant_fkey'
  ) then
    alter table public.valuations
      add constraint valuations_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_links'::regclass
      and conname = 'referral_links_customer_tenant_fkey'
  ) then
    alter table public.referral_links
      add constraint referral_links_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_links'::regclass
      and conname = 'referral_links_staff_tenant_fkey'
  ) then
    alter table public.referral_links
      add constraint referral_links_staff_tenant_fkey
      foreign key (staff_id, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_links'::regclass
      and conname = 'referral_links_creator_tenant_fkey'
  ) then
    alter table public.referral_links
      add constraint referral_links_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referrals'::regclass
      and conname = 'referrals_link_tenant_fkey'
  ) then
    alter table public.referrals
      add constraint referrals_link_tenant_fkey
      foreign key (link_id, tenant_id)
      references public.referral_links(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referrals'::regclass
      and conname = 'referrals_referrer_tenant_fkey'
  ) then
    alter table public.referrals
      add constraint referrals_referrer_tenant_fkey
      foreign key (referrer_customer_id, tenant_id)
      references public.customers(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referrals'::regclass
      and conname = 'referrals_created_customer_tenant_fkey'
  ) then
    alter table public.referrals
      add constraint referrals_created_customer_tenant_fkey
      foreign key (created_customer_id, tenant_id)
      references public.customers(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referrals'::regclass
      and conname = 'referrals_handler_tenant_fkey'
  ) then
    alter table public.referrals
      add constraint referrals_handler_tenant_fkey
      foreign key (handled_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.surveys'::regclass
      and conname = 'surveys_deal_tenant_fkey'
  ) then
    alter table public.surveys
      add constraint surveys_deal_tenant_fkey
      foreign key (deal_id, tenant_id)
      references public.deals(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.surveys'::regclass
      and conname = 'surveys_customer_tenant_fkey'
  ) then
    alter table public.surveys
      add constraint surveys_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.surveys'::regclass
      and conname = 'surveys_agent_tenant_fkey'
  ) then
    alter table public.surveys
      add constraint surveys_agent_tenant_fkey
      foreign key (agent_id, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.booking_settings'::regclass
      and conname = 'booking_settings_staff_tenant_fkey'
  ) then
    alter table public.booking_settings
      add constraint booking_settings_staff_tenant_fkey
      foreign key (staff_id, tenant_id)
      references public.profiles(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.open_houses'::regclass
      and conname = 'open_houses_property_tenant_fkey'
  ) then
    alter table public.open_houses
      add constraint open_houses_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.open_houses'::regclass
      and conname = 'open_houses_creator_tenant_fkey'
  ) then
    alter table public.open_houses
      add constraint open_houses_creator_tenant_fkey
      foreign key (created_by, tenant_id)
      references public.profiles(id, tenant_id)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.portal_match_feedback'::regclass
      and conname = 'portal_match_feedback_customer_tenant_fkey'
  ) then
    alter table public.portal_match_feedback
      add constraint portal_match_feedback_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.portal_match_feedback'::regclass
      and conname = 'portal_match_feedback_property_tenant_fkey'
  ) then
    alter table public.portal_match_feedback
      add constraint portal_match_feedback_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete cascade
      not valid;
  end if;
end;
$$;

-- share_links is polymorphic, so a composite FK cannot express its parent.
create or replace function public.enforce_share_link_tenant_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_type = 'property' and not exists (
    select 1 from public.properties p
    where p.id = new.entity_id and p.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23503', message = 'share link property tenant mismatch';
  elsif new.entity_type = 'customer' and not exists (
    select 1 from public.customers c
    where c.id = new.entity_id and c.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23503', message = 'share link customer tenant mismatch';
  elsif new.entity_type = 'demand' and not exists (
    select 1 from public.customer_demands d
    where d.id = new.entity_id and d.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23503', message = 'share link demand tenant mismatch';
  end if;

  if new.created_by is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.created_by and p.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23503', message = 'share link creator tenant mismatch';
  end if;

  return new;
end;
$$;

revoke all privileges on function public.enforce_share_link_tenant_parent()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_share_link_tenant_parent on public.share_links;
create trigger trg_share_link_tenant_parent
before insert or update of tenant_id, entity_type, entity_id, created_by
on public.share_links
for each row execute function public.enforce_share_link_tenant_parent();

-- open_house_visitors derives its tenant through open_house_id. Guard its
-- optional customer link explicitly because the table has no tenant_id column.
create or replace function public.enforce_open_house_visitor_tenant_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select oh.tenant_id into v_tenant_id
  from public.open_houses oh
  where oh.id = new.open_house_id;

  if v_tenant_id is null then
    raise exception using errcode = '23503', message = 'open house visitor parent missing';
  end if;

  if new.created_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = new.created_customer_id
      and c.tenant_id = v_tenant_id
      and c.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'open house visitor customer tenant mismatch';
  end if;

  return new;
end;
$$;

revoke all privileges on function public.enforce_open_house_visitor_tenant_parent()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_open_house_visitor_tenant_parent on public.open_house_visitors;
create trigger trg_open_house_visitor_tenant_parent
before insert or update of open_house_id, created_customer_id
on public.open_house_visitors
for each row execute function public.enforce_open_house_visitor_tenant_parent();

-- Replace broad legacy policies with active-tenant and action-aware gates.
drop policy if exists customer_portal_tokens_tenant on public.customer_portal_tokens;
drop policy if exists customer_portal_tokens_tenant_insert on public.customer_portal_tokens;
drop policy if exists capability_customer_portal_select on public.customer_portal_tokens;
drop policy if exists capability_customer_portal_insert on public.customer_portal_tokens;
drop policy if exists capability_customer_portal_update on public.customer_portal_tokens;
drop policy if exists capability_customer_portal_delete on public.customer_portal_tokens;
create policy capability_customer_portal_select on public.customer_portal_tokens
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'view')
);
create policy capability_customer_portal_insert on public.customer_portal_tokens
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
);
create policy capability_customer_portal_update on public.customer_portal_tokens
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
) with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
);
create policy capability_customer_portal_delete on public.customer_portal_tokens
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
);

drop policy if exists owner_portal_tokens_tenant on public.owner_portal_tokens;
drop policy if exists owner_portal_tokens_insert on public.owner_portal_tokens;
drop policy if exists capability_owner_portal_select on public.owner_portal_tokens;
drop policy if exists capability_owner_portal_insert on public.owner_portal_tokens;
drop policy if exists capability_owner_portal_update on public.owner_portal_tokens;
drop policy if exists capability_owner_portal_delete on public.owner_portal_tokens;
create policy capability_owner_portal_select on public.owner_portal_tokens
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'view')
);
create policy capability_owner_portal_insert on public.owner_portal_tokens
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);
create policy capability_owner_portal_update on public.owner_portal_tokens
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
) with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);
create policy capability_owner_portal_delete on public.owner_portal_tokens
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);

drop policy if exists share_links_tenant on public.share_links;
drop policy if exists capability_share_links_select on public.share_links;
drop policy if exists capability_share_links_insert on public.share_links;
drop policy if exists capability_share_links_update on public.share_links;
drop policy if exists capability_share_links_delete on public.share_links;
create policy capability_share_links_select on public.share_links
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'view')
);
create policy capability_share_links_insert on public.share_links
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);
create policy capability_share_links_update on public.share_links
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
) with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);
create policy capability_share_links_delete on public.share_links
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('properties', 'edit')
);

drop policy if exists valuations_tenant on public.valuations;
drop policy if exists capability_valuations_select on public.valuations;
drop policy if exists capability_valuations_insert on public.valuations;
drop policy if exists capability_valuations_update on public.valuations;
drop policy if exists capability_valuations_delete on public.valuations;
create policy capability_valuations_select on public.valuations
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('valuation', 'view')
);
create policy capability_valuations_insert on public.valuations
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('valuation', 'create')
);
create policy capability_valuations_update on public.valuations
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('valuation', 'edit')
) with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('valuation', 'edit')
);
create policy capability_valuations_delete on public.valuations
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('valuation', 'delete')
);

drop policy if exists referral_links_tenant on public.referral_links;
drop policy if exists capability_referral_links_select on public.referral_links;
drop policy if exists capability_referral_links_insert on public.referral_links;
drop policy if exists capability_referral_links_update on public.referral_links;
drop policy if exists capability_referral_links_delete on public.referral_links;
create policy capability_referral_links_select on public.referral_links
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'view')
);
create policy capability_referral_links_insert on public.referral_links
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
);
create policy capability_referral_links_update on public.referral_links
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
) with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
);
create policy capability_referral_links_delete on public.referral_links
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'delete')
);

drop policy if exists referrals_tenant on public.referrals;
drop policy if exists capability_referrals_select on public.referrals;
drop policy if exists capability_referrals_insert on public.referrals;
drop policy if exists capability_referrals_update on public.referrals;
drop policy if exists capability_referrals_delete on public.referrals;
create policy capability_referrals_select on public.referrals
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'view')
);
create policy capability_referrals_insert on public.referrals
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'edit')
);
create policy capability_referrals_update on public.referrals
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and (
    public.has_effective_permission('customers', 'edit')
    or public.has_effective_permission('customers', 'create')
  )
) with check (
  tenant_id = public.current_active_tenant_id()
  and (
    public.has_effective_permission('customers', 'edit')
    or public.has_effective_permission('customers', 'create')
  )
);
create policy capability_referrals_delete on public.referrals
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'delete')
);

drop policy if exists surveys_tenant on public.surveys;
drop policy if exists capability_surveys_select on public.surveys;
drop policy if exists capability_surveys_insert on public.surveys;
drop policy if exists capability_surveys_update on public.surveys;
drop policy if exists capability_surveys_delete on public.surveys;
create policy capability_surveys_select on public.surveys
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('reports', 'view')
);
create policy capability_surveys_insert on public.surveys
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('reports', 'view')
  and public.has_effective_permission('commissions', 'view')
);
create policy capability_surveys_update on public.surveys
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('reports', 'edit')
) with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('reports', 'edit')
);
create policy capability_surveys_delete on public.surveys
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('reports', 'delete')
);

drop policy if exists booking_settings_tenant on public.booking_settings;
drop policy if exists capability_booking_settings_select on public.booking_settings;
drop policy if exists capability_booking_settings_insert on public.booking_settings;
drop policy if exists capability_booking_settings_update on public.booking_settings;
drop policy if exists capability_booking_settings_delete on public.booking_settings;
create policy capability_booking_settings_select on public.booking_settings
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'view')
);
create policy capability_booking_settings_insert on public.booking_settings
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'edit')
);
create policy capability_booking_settings_update on public.booking_settings
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'edit')
) with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'edit')
);
create policy capability_booking_settings_delete on public.booking_settings
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'edit')
);

drop policy if exists open_houses_tenant on public.open_houses;
drop policy if exists open_houses_tenant_insert on public.open_houses;
drop policy if exists capability_open_houses_select on public.open_houses;
drop policy if exists capability_open_houses_insert on public.open_houses;
drop policy if exists capability_open_houses_update on public.open_houses;
drop policy if exists capability_open_houses_delete on public.open_houses;
create policy capability_open_houses_select on public.open_houses
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'view')
);
create policy capability_open_houses_insert on public.open_houses
for insert to authenticated with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'create')
);
create policy capability_open_houses_update on public.open_houses
for update to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'edit')
) with check (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'edit')
);
create policy capability_open_houses_delete on public.open_houses
for delete to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('appointments', 'delete')
);

drop policy if exists open_house_visitors_tenant on public.open_house_visitors;
drop policy if exists open_house_visitors_insert on public.open_house_visitors;
drop policy if exists capability_open_house_visitors_select on public.open_house_visitors;
drop policy if exists capability_open_house_visitors_insert on public.open_house_visitors;
drop policy if exists capability_open_house_visitors_update on public.open_house_visitors;
drop policy if exists capability_open_house_visitors_delete on public.open_house_visitors;
create policy capability_open_house_visitors_select on public.open_house_visitors
for select to authenticated using (
  exists (
    select 1 from public.open_houses oh
    where oh.id = open_house_id
      and oh.tenant_id = public.current_active_tenant_id()
  )
  and (
    public.has_effective_permission('appointments', 'view')
    or public.has_effective_permission('customers', 'create')
  )
);
create policy capability_open_house_visitors_insert on public.open_house_visitors
for insert to authenticated with check (
  exists (
    select 1 from public.open_houses oh
    where oh.id = open_house_id
      and oh.tenant_id = public.current_active_tenant_id()
  )
  and public.has_effective_permission('appointments', 'create')
);
create policy capability_open_house_visitors_update on public.open_house_visitors
for update to authenticated using (
  exists (
    select 1 from public.open_houses oh
    where oh.id = open_house_id
      and oh.tenant_id = public.current_active_tenant_id()
  )
  and (
    public.has_effective_permission('appointments', 'edit')
    or public.has_effective_permission('customers', 'create')
  )
) with check (
  exists (
    select 1 from public.open_houses oh
    where oh.id = open_house_id
      and oh.tenant_id = public.current_active_tenant_id()
  )
  and (
    public.has_effective_permission('appointments', 'edit')
    or public.has_effective_permission('customers', 'create')
  )
);
create policy capability_open_house_visitors_delete on public.open_house_visitors
for delete to authenticated using (
  exists (
    select 1 from public.open_houses oh
    where oh.id = open_house_id
      and oh.tenant_id = public.current_active_tenant_id()
  )
  and public.has_effective_permission('appointments', 'delete')
);

drop policy if exists pmf_tenant_select on public.portal_match_feedback;
drop policy if exists capability_portal_match_feedback_select on public.portal_match_feedback;
create policy capability_portal_match_feedback_select on public.portal_match_feedback
for select to authenticated using (
  tenant_id = public.current_active_tenant_id()
  and public.has_effective_permission('customers', 'view')
);
