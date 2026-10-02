-- CRM and field-operations tenant relationship boundaries.
--
-- Child-table RLS protects which tenant row a caller may write, but a global
-- UUID foreign key alone does not prove that the selected parent belongs to
-- the same tenant. These static composite foreign keys make that invariant a
-- database property across the remaining user-writable CRM relationships.
--
-- Every relationship preserves its original delete action. PostgreSQL 17's
-- column-list SET NULL form clears only the optional parent UUID and never the
-- child's non-null tenant_id. NOT VALID starts enforcement for new writes with
-- a short lock; VALIDATE proves the already-audited historical rows.

-- Composite parent keys required by the explicit foreign keys below.
create unique index if not exists idx_profiles_id_tenant_unique
  on public.profiles(id, tenant_id);
create unique index if not exists idx_customers_id_tenant_unique
  on public.customers(id, tenant_id);
create unique index if not exists idx_properties_id_tenant_unique
  on public.properties(id, tenant_id);
create unique index if not exists idx_deals_id_tenant_unique
  on public.deals(id, tenant_id);
create unique index if not exists idx_portal_listings_id_tenant_unique
  on public.portal_listings(id, tenant_id);
create unique index if not exists idx_offers_id_tenant_unique
  on public.offers(id, tenant_id);
create unique index if not exists idx_automations_id_tenant_unique
  on public.automations(id, tenant_id);
create unique index if not exists idx_tasks_id_tenant_unique
  on public.tasks(id, tenant_id);
create unique index if not exists idx_rentals_id_tenant_unique
  on public.rentals(id, tenant_id);
create unique index if not exists idx_projects_id_tenant_unique
  on public.projects(id, tenant_id);
create unique index if not exists idx_project_units_id_tenant_unique
  on public.project_units(id, tenant_id);
create unique index if not exists idx_property_keys_id_tenant_unique
  on public.property_keys(id, tenant_id);
create unique index if not exists idx_approval_requests_id_tenant_unique
  on public.approval_requests(id, tenant_id);
create unique index if not exists idx_playbooks_id_tenant_unique
  on public.playbooks(id, tenant_id);

-- Customer and property ownership/provenance.
alter table public.customers
  add constraint customers_assignee_tenant_fkey
  foreign key (assigned_to, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.customers
  add constraint customers_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.customer_demands
  add constraint customer_demands_customer_tenant_fkey
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id)
  on delete cascade
  not valid;

alter table public.properties
  add constraint properties_assignee_tenant_fkey
  foreign key (assigned_to, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.properties
  add constraint properties_source_agent_tenant_fkey
  foreign key (source_agent, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.properties
  add constraint properties_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

-- Listing publication and closure chain.
alter table public.portal_listings
  add constraint portal_listings_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete cascade
  not valid;

alter table public.portal_listings
  add constraint portal_listings_publisher_tenant_fkey
  foreign key (published_by, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.listing_closures
  add constraint listing_closures_listing_tenant_fkey
  foreign key (portal_listing_id, tenant_id)
  references public.portal_listings(id, tenant_id)
  on delete cascade
  not valid;

alter table public.listing_closures
  add constraint listing_closures_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

-- Deal, commission, call and consent chain.
alter table public.deals
  add constraint deals_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  not valid;

alter table public.deals
  add constraint deals_customer_tenant_fkey
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id)
  not valid;

alter table public.deals
  add constraint deals_assignee_tenant_fkey
  foreign key (assigned_to, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.commissions
  add constraint commissions_deal_tenant_fkey
  foreign key (deal_id, tenant_id)
  references public.deals(id, tenant_id)
  on delete cascade
  not valid;

alter table public.calls
  add constraint calls_customer_tenant_fkey
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id)
  not valid;

alter table public.calls
  add constraint calls_handler_tenant_fkey
  foreign key (handled_by, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.iys_consents
  add constraint iys_consents_customer_tenant_fkey
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id)
  on delete cascade
  not valid;

-- Day-to-day CRM activity and financial records.
alter table public.campaigns
  add constraint campaigns_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.expenses
  add constraint expenses_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.expenses
  add constraint expenses_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete set null (property_id)
  not valid;

alter table public.communications
  add constraint communications_customer_tenant_fkey
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id)
  on delete cascade
  not valid;

alter table public.communications
  add constraint communications_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete set null (property_id)
  not valid;

alter table public.communications
  add constraint communications_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.targets
  add constraint targets_profile_tenant_fkey
  foreign key (profile_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete cascade
  not valid;

alter table public.automations
  add constraint automations_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.automation_logs
  add constraint automation_logs_automation_tenant_fkey
  foreign key (automation_id, tenant_id)
  references public.automations(id, tenant_id)
  on delete cascade
  not valid;

alter table public.property_dues
  add constraint property_dues_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete set null (property_id)
  not valid;

alter table public.property_dues
  add constraint property_dues_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

-- Immutable history and negotiation artifacts.
alter table public.property_price_history
  add constraint property_price_history_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete cascade
  not valid;

alter table public.property_price_history
  add constraint property_price_history_changer_tenant_fkey
  foreign key (changed_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (changed_by)
  not valid;

alter table public.property_status_history
  add constraint property_status_history_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete cascade
  not valid;

alter table public.property_status_history
  add constraint property_status_history_changer_tenant_fkey
  foreign key (changed_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (changed_by)
  not valid;

alter table public.offer_rounds
  add constraint offer_rounds_offer_tenant_fkey
  foreign key (offer_id, tenant_id)
  references public.offers(id, tenant_id)
  on delete cascade
  not valid;

alter table public.offer_rounds
  add constraint offer_rounds_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.deal_costs
  add constraint deal_costs_deal_tenant_fkey
  foreign key (deal_id, tenant_id)
  references public.deals(id, tenant_id)
  on delete cascade
  not valid;

alter table public.deal_costs
  add constraint deal_costs_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.deal_notes
  add constraint deal_notes_deal_tenant_fkey
  foreign key (deal_id, tenant_id)
  references public.deals(id, tenant_id)
  on delete cascade
  not valid;

alter table public.deal_notes
  add constraint deal_notes_author_tenant_fkey
  foreign key (author_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (author_id)
  not valid;

alter table public.deal_checklist_items
  add constraint deal_checklist_items_deal_tenant_fkey
  foreign key (deal_id, tenant_id)
  references public.deals(id, tenant_id)
  on delete cascade
  not valid;

alter table public.deal_checklist_items
  add constraint deal_checklist_items_completer_tenant_fkey
  foreign key (done_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (done_by)
  not valid;

alter table public.presentations
  add constraint presentations_customer_tenant_fkey
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id)
  on delete set null (customer_id)
  not valid;

alter table public.presentations
  add constraint presentations_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.tasks
  add constraint tasks_recurrence_parent_tenant_fkey
  foreign key (recurrence_parent_id, tenant_id)
  references public.tasks(id, tenant_id)
  on delete set null (recurrence_parent_id)
  not valid;

-- Rental, project and physical-key operations.
alter table public.rentals
  add constraint rentals_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete cascade
  not valid;

alter table public.rentals
  add constraint rentals_renter_tenant_fkey
  foreign key (renter_customer_id, tenant_id)
  references public.customers(id, tenant_id)
  on delete cascade
  not valid;

alter table public.rentals
  add constraint rentals_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.rent_charges
  add constraint rent_charges_rental_tenant_fkey
  foreign key (rental_id, tenant_id)
  references public.rentals(id, tenant_id)
  on delete cascade
  not valid;

alter table public.maintenance_requests
  add constraint maintenance_requests_rental_tenant_fkey
  foreign key (rental_id, tenant_id)
  references public.rentals(id, tenant_id)
  on delete cascade
  not valid;

alter table public.maintenance_requests
  add constraint maintenance_requests_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.projects
  add constraint projects_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.project_units
  add constraint project_units_project_tenant_fkey
  foreign key (project_id, tenant_id)
  references public.projects(id, tenant_id)
  on delete cascade
  not valid;

alter table public.project_units
  add constraint project_units_customer_tenant_fkey
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id)
  on delete set null (customer_id)
  not valid;

alter table public.unit_payments
  add constraint unit_payments_unit_tenant_fkey
  foreign key (unit_id, tenant_id)
  references public.project_units(id, tenant_id)
  on delete cascade
  not valid;

alter table public.unit_payments
  add constraint unit_payments_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.property_keys
  add constraint property_keys_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete cascade
  not valid;

alter table public.property_keys
  add constraint property_keys_holder_tenant_fkey
  foreign key (holder_staff_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (holder_staff_id)
  not valid;

alter table public.property_keys
  add constraint property_keys_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.property_key_events
  add constraint property_key_events_key_tenant_fkey
  foreign key (key_id, tenant_id)
  references public.property_keys(id, tenant_id)
  on delete cascade
  not valid;

alter table public.property_key_events
  add constraint property_key_events_staff_tenant_fkey
  foreign key (staff_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (staff_id)
  not valid;

-- User-writable collaboration, productivity and people operations.
alter table public.agent_badges
  add constraint agent_badges_staff_tenant_fkey
  foreign key (staff_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete cascade
  not valid;

alter table public.agent_score_snapshots
  add constraint agent_score_snapshots_staff_tenant_fkey
  foreign key (staff_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete cascade
  not valid;

alter table public.approval_requests
  add constraint approval_requests_requester_tenant_fkey
  foreign key (requested_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (requested_by)
  not valid;

alter table public.approval_requests
  add constraint approval_requests_decider_tenant_fkey
  foreign key (decided_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (decided_by)
  not valid;

alter table public.approval_comments
  add constraint approval_comments_request_tenant_fkey
  foreign key (request_id, tenant_id)
  references public.approval_requests(id, tenant_id)
  on delete cascade
  not valid;

alter table public.approval_comments
  add constraint approval_comments_author_tenant_fkey
  foreign key (author_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (author_id)
  not valid;

alter table public.listing_views
  add constraint listing_views_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete cascade
  not valid;

alter table public.lost_sale_dismissals
  add constraint lost_sale_dismissals_customer_tenant_fkey
  foreign key (customer_id, tenant_id)
  references public.customers(id, tenant_id)
  on delete cascade
  not valid;

alter table public.lost_sale_dismissals
  add constraint lost_sale_dismissals_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.announcements
  add constraint announcements_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.contract_templates
  add constraint contract_templates_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.message_templates
  add constraint message_templates_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.playbooks
  add constraint playbooks_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.playbook_steps
  add constraint playbook_steps_playbook_tenant_fkey
  foreign key (playbook_id, tenant_id)
  references public.playbooks(id, tenant_id)
  on delete cascade
  not valid;

alter table public.playbook_steps
  add constraint playbook_steps_assignee_tenant_fkey
  foreign key (assignee_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (assignee_id)
  not valid;

alter table public.playbook_runs
  add constraint playbook_runs_playbook_tenant_fkey
  foreign key (playbook_id, tenant_id)
  references public.playbooks(id, tenant_id)
  on delete cascade
  not valid;

alter table public.saved_views
  add constraint saved_views_user_tenant_fkey
  foreign key (user_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete cascade
  not valid;

alter table public.staff_leaves
  add constraint staff_leaves_staff_tenant_fkey
  foreign key (staff_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete cascade
  not valid;

alter table public.staff_leaves
  add constraint staff_leaves_creator_tenant_fkey
  foreign key (created_by, tenant_id)
  references public.profiles(id, tenant_id)
  on delete set null (created_by)
  not valid;

alter table public.tenant_advisor_sessions
  add constraint tenant_advisor_sessions_user_tenant_fkey
  foreign key (user_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete cascade
  not valid;

alter table public.tenant_role_permissions
  add constraint tenant_role_permissions_updater_tenant_fkey
  foreign key (updated_by, tenant_id)
  references public.profiles(id, tenant_id)
  not valid;

alter table public.vitrin_price_alerts
  add constraint vitrin_price_alerts_property_tenant_fkey
  foreign key (property_id, tenant_id)
  references public.properties(id, tenant_id)
  on delete cascade
  not valid;

-- Historical-row proof. The production audit preceding this migration found
-- zero tenant mismatches for every relationship validated below.
alter table public.customers validate constraint customers_assignee_tenant_fkey;
alter table public.customers validate constraint customers_creator_tenant_fkey;
alter table public.customer_demands validate constraint customer_demands_customer_tenant_fkey;
alter table public.properties validate constraint properties_assignee_tenant_fkey;
alter table public.properties validate constraint properties_source_agent_tenant_fkey;
alter table public.properties validate constraint properties_creator_tenant_fkey;
alter table public.portal_listings validate constraint portal_listings_property_tenant_fkey;
alter table public.portal_listings validate constraint portal_listings_publisher_tenant_fkey;
alter table public.listing_closures validate constraint listing_closures_listing_tenant_fkey;
alter table public.listing_closures validate constraint listing_closures_creator_tenant_fkey;
alter table public.deals validate constraint deals_property_tenant_fkey;
alter table public.deals validate constraint deals_customer_tenant_fkey;
alter table public.deals validate constraint deals_assignee_tenant_fkey;
alter table public.commissions validate constraint commissions_deal_tenant_fkey;
alter table public.calls validate constraint calls_customer_tenant_fkey;
alter table public.calls validate constraint calls_handler_tenant_fkey;
alter table public.iys_consents validate constraint iys_consents_customer_tenant_fkey;
alter table public.campaigns validate constraint campaigns_creator_tenant_fkey;
alter table public.expenses validate constraint expenses_creator_tenant_fkey;
alter table public.expenses validate constraint expenses_property_tenant_fkey;
alter table public.communications validate constraint communications_customer_tenant_fkey;
alter table public.communications validate constraint communications_property_tenant_fkey;
alter table public.communications validate constraint communications_creator_tenant_fkey;
alter table public.targets validate constraint targets_profile_tenant_fkey;
alter table public.automations validate constraint automations_creator_tenant_fkey;
alter table public.automation_logs validate constraint automation_logs_automation_tenant_fkey;
alter table public.property_dues validate constraint property_dues_property_tenant_fkey;
alter table public.property_dues validate constraint property_dues_creator_tenant_fkey;
alter table public.property_price_history validate constraint property_price_history_property_tenant_fkey;
alter table public.property_price_history validate constraint property_price_history_changer_tenant_fkey;
alter table public.property_status_history validate constraint property_status_history_property_tenant_fkey;
alter table public.property_status_history validate constraint property_status_history_changer_tenant_fkey;
alter table public.offer_rounds validate constraint offer_rounds_offer_tenant_fkey;
alter table public.offer_rounds validate constraint offer_rounds_creator_tenant_fkey;
alter table public.deal_costs validate constraint deal_costs_deal_tenant_fkey;
alter table public.deal_costs validate constraint deal_costs_creator_tenant_fkey;
alter table public.deal_notes validate constraint deal_notes_deal_tenant_fkey;
alter table public.deal_notes validate constraint deal_notes_author_tenant_fkey;
alter table public.deal_checklist_items validate constraint deal_checklist_items_deal_tenant_fkey;
alter table public.deal_checklist_items validate constraint deal_checklist_items_completer_tenant_fkey;
alter table public.presentations validate constraint presentations_customer_tenant_fkey;
alter table public.presentations validate constraint presentations_creator_tenant_fkey;
alter table public.tasks validate constraint tasks_recurrence_parent_tenant_fkey;
alter table public.rentals validate constraint rentals_property_tenant_fkey;
alter table public.rentals validate constraint rentals_renter_tenant_fkey;
alter table public.rentals validate constraint rentals_creator_tenant_fkey;
alter table public.rent_charges validate constraint rent_charges_rental_tenant_fkey;
alter table public.maintenance_requests validate constraint maintenance_requests_rental_tenant_fkey;
alter table public.maintenance_requests validate constraint maintenance_requests_creator_tenant_fkey;
alter table public.projects validate constraint projects_creator_tenant_fkey;
alter table public.project_units validate constraint project_units_project_tenant_fkey;
alter table public.project_units validate constraint project_units_customer_tenant_fkey;
alter table public.unit_payments validate constraint unit_payments_unit_tenant_fkey;
alter table public.unit_payments validate constraint unit_payments_creator_tenant_fkey;
alter table public.property_keys validate constraint property_keys_property_tenant_fkey;
alter table public.property_keys validate constraint property_keys_holder_tenant_fkey;
alter table public.property_keys validate constraint property_keys_creator_tenant_fkey;
alter table public.property_key_events validate constraint property_key_events_key_tenant_fkey;
alter table public.property_key_events validate constraint property_key_events_staff_tenant_fkey;
alter table public.agent_badges validate constraint agent_badges_staff_tenant_fkey;
alter table public.agent_score_snapshots validate constraint agent_score_snapshots_staff_tenant_fkey;
alter table public.approval_requests validate constraint approval_requests_requester_tenant_fkey;
alter table public.approval_requests validate constraint approval_requests_decider_tenant_fkey;
alter table public.approval_comments validate constraint approval_comments_request_tenant_fkey;
alter table public.approval_comments validate constraint approval_comments_author_tenant_fkey;
alter table public.listing_views validate constraint listing_views_property_tenant_fkey;
alter table public.lost_sale_dismissals validate constraint lost_sale_dismissals_customer_tenant_fkey;
alter table public.lost_sale_dismissals validate constraint lost_sale_dismissals_creator_tenant_fkey;
alter table public.announcements validate constraint announcements_creator_tenant_fkey;
alter table public.contract_templates validate constraint contract_templates_creator_tenant_fkey;
alter table public.message_templates validate constraint message_templates_creator_tenant_fkey;
alter table public.playbooks validate constraint playbooks_creator_tenant_fkey;
alter table public.playbook_steps validate constraint playbook_steps_playbook_tenant_fkey;
alter table public.playbook_steps validate constraint playbook_steps_assignee_tenant_fkey;
alter table public.playbook_runs validate constraint playbook_runs_playbook_tenant_fkey;
alter table public.saved_views validate constraint saved_views_user_tenant_fkey;
alter table public.staff_leaves validate constraint staff_leaves_staff_tenant_fkey;
alter table public.staff_leaves validate constraint staff_leaves_creator_tenant_fkey;
alter table public.tenant_advisor_sessions validate constraint tenant_advisor_sessions_user_tenant_fkey;
alter table public.tenant_role_permissions validate constraint tenant_role_permissions_updater_tenant_fkey;
alter table public.vitrin_price_alerts validate constraint vitrin_price_alerts_property_tenant_fkey;
