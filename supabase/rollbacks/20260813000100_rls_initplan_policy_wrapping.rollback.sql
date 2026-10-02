-- GERİ ALMA: 20260813000100_rls_initplan_policy_wrapping.sql uygulanmadan ÖNCE canlıdan alınan politika ifadeleri.
-- Bu dosya migration değildir (supabase/migrations dışında); gerekirse elle çalıştırılır.
-- Kullanım: psql ... -f supabase/rollbacks/20260813000100_rls_initplan_policy_wrapping.rollback.sql
begin;
set local search_path = public, extensions;

alter policy "agent_badges_tenant" on public.agent_badges
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "agent_score_snapshots_tenant" on public.agent_score_snapshots
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "announcement_reads_insert" on public.announcement_reads
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM announcements a
  WHERE ((a.id = announcement_reads.announcement_id) AND (a.tenant_id = current_tenant_id()))))));

alter policy "announcement_reads_select" on public.announcement_reads
  using ((EXISTS ( SELECT 1
   FROM announcements a
  WHERE ((a.id = announcement_reads.announcement_id) AND (a.tenant_id = current_tenant_id())))));

alter policy "announcements_tenant_delete" on public.announcements
  using ((tenant_id = current_tenant_id()));

alter policy "announcements_tenant_insert" on public.announcements
  with check ((tenant_id = current_tenant_id()));

alter policy "announcements_tenant_select" on public.announcements
  using ((tenant_id = current_tenant_id()));

alter policy "announcements_tenant_update" on public.announcements
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "identity_appointments_delete" on public.appointments
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'delete'::text)));

alter policy "identity_appointments_insert" on public.appointments
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'create'::text)));

alter policy "identity_appointments_select" on public.appointments
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'view'::text)));

alter policy "identity_appointments_update" on public.appointments
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'edit'::text)));

alter policy "approval_comments_tenant" on public.approval_comments
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "approval_requests_tenant" on public.approval_requests
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "audit_tenant" on public.audit_logs
  using ((tenant_id = current_tenant_id()));

alter policy "automation_logs_tenant" on public.automation_logs
  using ((tenant_id = current_tenant_id()));

alter policy "automations_insert" on public.automations
  with check ((tenant_id = current_tenant_id()));

alter policy "automations_tenant" on public.automations
  using ((tenant_id = current_tenant_id()));

alter policy "automations_update" on public.automations
  using ((tenant_id = current_tenant_id()));

alter policy "capability_booking_settings_delete" on public.booking_settings
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'edit'::text)));

alter policy "capability_booking_settings_insert" on public.booking_settings
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'edit'::text)));

alter policy "capability_booking_settings_select" on public.booking_settings
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'view'::text)));

alter policy "capability_booking_settings_update" on public.booking_settings
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('appointments'::text, 'edit'::text)));

alter policy "identity_branches_delete" on public.branches
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('team'::text, 'delete'::text)));

alter policy "identity_branches_insert" on public.branches
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('team'::text, 'create'::text)));

alter policy "identity_branches_select" on public.branches
  using ((tenant_id = current_active_tenant_id()));

alter policy "identity_branches_update" on public.branches
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('team'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('team'::text, 'edit'::text)));

alter policy "identity_calls_delete" on public.calls
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('calls'::text, 'delete'::text)));

alter policy "identity_calls_insert" on public.calls
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('calls'::text, 'create'::text)));

alter policy "identity_calls_select" on public.calls
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('calls'::text, 'view'::text)));

alter policy "identity_calls_update" on public.calls
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('calls'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('calls'::text, 'edit'::text)));

alter policy "campaign_recipients_insert" on public.campaign_recipients
  with check ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.tenant_id = current_tenant_id()))));

alter policy "campaign_recipients_tenant" on public.campaign_recipients
  using ((campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.tenant_id = current_tenant_id()))));

alter policy "identity_campaigns_delete" on public.campaigns
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('campaigns'::text, 'delete'::text)));

alter policy "identity_campaigns_insert" on public.campaigns
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('campaigns'::text, 'create'::text)));

alter policy "identity_campaigns_select" on public.campaigns
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('campaigns'::text, 'view'::text)));

alter policy "identity_campaigns_update" on public.campaigns
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('campaigns'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('campaigns'::text, 'edit'::text)));

alter policy "commissions_delete" on public.commissions
  using (((tenant_id = current_tenant_id()) AND has_effective_permission('commissions'::text, 'delete'::text)));

alter policy "commissions_insert" on public.commissions
  with check (((tenant_id = current_tenant_id()) AND has_effective_permission('commissions'::text, 'create'::text)));

alter policy "commissions_select" on public.commissions
  using (((tenant_id = current_tenant_id()) AND has_effective_permission('commissions'::text, 'view'::text)));

alter policy "commissions_update" on public.commissions
  using (((tenant_id = current_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)))
  with check (((tenant_id = current_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "identity_communications_delete" on public.communications
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'delete'::text)));

alter policy "identity_communications_insert" on public.communications
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'create'::text)));

alter policy "identity_communications_select" on public.communications
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'view'::text)));

alter policy "identity_communications_update" on public.communications
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)));

alter policy "contract_templates_delete" on public.contract_templates
  using ((tenant_id = current_tenant_id()));

alter policy "contract_templates_insert" on public.contract_templates
  with check ((tenant_id = current_tenant_id()));

alter policy "contract_templates_select" on public.contract_templates
  using (((tenant_id IS NULL) OR (tenant_id = current_tenant_id())));

alter policy "contract_templates_update" on public.contract_templates
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "workflow_contract_versions_select" on public.contract_versions
  using ((EXISTS ( SELECT 1
   FROM contracts c
  WHERE ((c.id = contract_versions.contract_id) AND (c.tenant_id = current_active_tenant_id()) AND has_effective_permission('contracts'::text, 'view'::text)))));

alter policy "identity_contracts_delete" on public.contracts
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('contracts'::text, 'delete'::text)));

alter policy "identity_contracts_insert" on public.contracts
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('contracts'::text, 'create'::text)));

alter policy "identity_contracts_select" on public.contracts
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('contracts'::text, 'view'::text)));

alter policy "identity_contracts_update" on public.contracts
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('contracts'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('contracts'::text, 'edit'::text)));

alter policy "cron_heartbeats_staff_read" on public.cron_heartbeats
  using (is_platform_staff());

alter policy "identity_customer_demands_delete" on public.customer_demands
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('demands'::text, 'delete'::text)));

alter policy "identity_customer_demands_insert" on public.customer_demands
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('demands'::text, 'create'::text)));

alter policy "identity_customer_demands_select" on public.customer_demands
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('demands'::text, 'view'::text)));

alter policy "identity_customer_demands_update" on public.customer_demands
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('demands'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('demands'::text, 'edit'::text)));

alter policy "identity_customer_files_delete" on public.customer_files
  using (((tenant_id = current_active_tenant_id()) AND (has_effective_permission('customers'::text, 'edit'::text) OR has_effective_permission('customers'::text, 'delete'::text))));

alter policy "identity_customer_files_insert" on public.customer_files
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid))));

alter policy "identity_customer_files_select" on public.customer_files
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'view'::text)));

alter policy "capability_customer_portal_delete" on public.customer_portal_tokens
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)));

alter policy "capability_customer_portal_insert" on public.customer_portal_tokens
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)));

alter policy "capability_customer_portal_select" on public.customer_portal_tokens
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'view'::text)));

alter policy "capability_customer_portal_update" on public.customer_portal_tokens
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)));

alter policy "identity_customers_delete" on public.customers
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'delete'::text)));

alter policy "identity_customers_insert" on public.customers
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'create'::text)));

alter policy "identity_customers_select" on public.customers
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'view'::text)));

alter policy "identity_customers_update" on public.customers
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)));

alter policy "workflow_deal_checklist_delete" on public.deal_checklist_items
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "workflow_deal_checklist_insert" on public.deal_checklist_items
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "workflow_deal_checklist_select" on public.deal_checklist_items
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'view'::text)));

alter policy "workflow_deal_checklist_update" on public.deal_checklist_items
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "workflow_deal_costs_delete" on public.deal_costs
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "workflow_deal_costs_insert" on public.deal_costs
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "workflow_deal_costs_select" on public.deal_costs
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'view'::text)));

alter policy "workflow_deal_costs_update" on public.deal_costs
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "workflow_deal_notes_delete" on public.deal_notes
  using (((tenant_id = current_active_tenant_id()) AND (author_id = auth.uid()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "workflow_deal_notes_insert" on public.deal_notes
  with check (((tenant_id = current_active_tenant_id()) AND (author_id = auth.uid()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "workflow_deal_notes_select" on public.deal_notes
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'view'::text)));

alter policy "identity_deals_delete" on public.deals
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'delete'::text)));

alter policy "identity_deals_insert" on public.deals
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'create'::text)));

alter policy "identity_deals_select" on public.deals
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'view'::text)));

alter policy "identity_deals_update" on public.deals
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));

alter policy "definitions_delete" on public.definitions
  using ((tenant_id = current_tenant_id()));

alter policy "definitions_insert" on public.definitions
  with check ((tenant_id = current_tenant_id()));

alter policy "definitions_read" on public.definitions
  using (((tenant_id IS NULL) OR (tenant_id = current_tenant_id())));

alter policy "definitions_update" on public.definitions
  using ((tenant_id = current_tenant_id()));

alter policy "demo_requests_platform" on public.demo_requests
  using (is_platform_staff())
  with check (is_platform_staff());

alter policy "error_logs_staff_all" on public.error_logs
  using (is_platform_staff())
  with check (is_platform_staff());

alter policy "error_logs_tenant_read" on public.error_logs
  using ((tenant_id = current_tenant_id()));

alter policy "identity_expenses_delete" on public.expenses
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('expenses'::text, 'delete'::text)));

alter policy "identity_expenses_insert" on public.expenses
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('expenses'::text, 'create'::text)));

alter policy "identity_expenses_select" on public.expenses
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('expenses'::text, 'view'::text)));

alter policy "identity_expenses_update" on public.expenses
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('expenses'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('expenses'::text, 'edit'::text)));

alter policy "invoices_staff_all" on public.invoices
  using (is_platform_staff())
  with check (is_platform_staff());

alter policy "invoices_tenant_select" on public.invoices
  using (((tenant_id = current_tenant_id()) OR is_platform_staff()));

alter policy "identity_iys_consents_delete" on public.iys_consents
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('compliance'::text, 'delete'::text)));

alter policy "identity_iys_consents_insert" on public.iys_consents
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('compliance'::text, 'create'::text)));

alter policy "identity_iys_consents_select" on public.iys_consents
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('compliance'::text, 'view'::text)));

alter policy "identity_iys_consents_update" on public.iys_consents
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('compliance'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('compliance'::text, 'edit'::text)));

alter policy "kvkk_erasure_staff" on public.kvkk_erasure_log
  using (is_platform_staff())
  with check (is_platform_staff());

alter policy "kvkk_erasure_tenant" on public.kvkk_erasure_log
  using ((tenant_id = current_tenant_id()));

alter policy "workflow_listing_closures_select" on public.listing_closures
  using (((tenant_id = current_active_tenant_id()) AND (has_effective_permission('portals'::text, 'view'::text) OR has_effective_permission('leak'::text, 'view'::text) OR has_effective_permission('reports'::text, 'view'::text))));

alter policy "listing_views_tenant_read" on public.listing_views
  using ((tenant_id = current_tenant_id()));

alter policy "lookup_values_delete" on public.lookup_values
  using (((tenant_id = current_tenant_id()) AND (is_system = false)));

alter policy "lookup_values_insert" on public.lookup_values
  with check ((tenant_id = current_tenant_id()));

alter policy "lookup_values_read" on public.lookup_values
  using (((tenant_id IS NULL) OR (tenant_id = current_tenant_id())));

alter policy "lookup_values_update" on public.lookup_values
  using (((tenant_id = current_tenant_id()) AND (is_system = false)));

alter policy "lsd_tenant" on public.lost_sale_dismissals
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "workflow_maintenance_delete" on public.maintenance_requests
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'delete'::text)));

alter policy "workflow_maintenance_insert" on public.maintenance_requests
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'create'::text)));

alter policy "workflow_maintenance_select" on public.maintenance_requests
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'view'::text)));

alter policy "workflow_maintenance_update" on public.maintenance_requests
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'edit'::text)));

alter policy "message_templates_tenant_delete" on public.message_templates
  using ((tenant_id = current_tenant_id()));

alter policy "message_templates_tenant_insert" on public.message_templates
  with check ((tenant_id = current_tenant_id()));

alter policy "message_templates_tenant_select" on public.message_templates
  using ((tenant_id = current_tenant_id()));

alter policy "message_templates_tenant_update" on public.message_templates
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "network_demand_responses_insert" on public.network_demand_responses
  with check ((from_tenant_id = current_tenant_id()));

alter policy "network_demand_responses_respond" on public.network_demand_responses
  using (((to_tenant_id = current_tenant_id()) AND (status = 'pending'::text)))
  with check (((to_tenant_id = current_tenant_id()) AND (status = ANY (ARRAY['accepted'::text, 'rejected'::text]))));

alter policy "network_demand_responses_select" on public.network_demand_responses
  using (((from_tenant_id = current_tenant_id()) OR (to_tenant_id = current_tenant_id())));

alter policy "network_demand_responses_withdraw" on public.network_demand_responses
  using (((from_tenant_id = current_tenant_id()) AND (status = 'pending'::text)))
  with check (((from_tenant_id = current_tenant_id()) AND (status = 'withdrawn'::text)));

alter policy "network_demands_tenant" on public.network_demands
  using ((tenant_id = current_tenant_id()));

alter policy "network_demands_tenant_insert" on public.network_demands
  with check ((tenant_id = current_tenant_id()));

alter policy "network_listings_tenant" on public.network_listings
  using ((tenant_id = current_tenant_id()));

alter policy "network_listings_tenant_insert" on public.network_listings
  with check ((tenant_id = current_tenant_id()));

alter policy "network_requests_insert" on public.network_requests
  with check ((from_tenant_id = current_tenant_id()));

alter policy "network_requests_respond" on public.network_requests
  using (((to_tenant_id = current_tenant_id()) AND (status = 'pending'::text)))
  with check (((to_tenant_id = current_tenant_id()) AND (status = ANY (ARRAY['accepted'::text, 'rejected'::text]))));

alter policy "network_requests_select" on public.network_requests
  using (((from_tenant_id = current_tenant_id()) OR (to_tenant_id = current_tenant_id())));

alter policy "network_requests_withdraw" on public.network_requests
  using (((from_tenant_id = current_tenant_id()) AND (status = 'pending'::text)))
  with check (((from_tenant_id = current_tenant_id()) AND (status = 'withdrawn'::text)));

alter policy "notifications_tenant_select" on public.notifications
  using (((tenant_id = current_tenant_id()) AND ((user_id IS NULL) OR (user_id = auth.uid()))));

alter policy "notifications_tenant_update" on public.notifications
  using (((tenant_id = current_tenant_id()) AND ((user_id IS NULL) OR (user_id = auth.uid()))))
  with check (((tenant_id = current_tenant_id()) AND ((user_id IS NULL) OR (user_id = auth.uid()))));

alter policy "workflow_offer_rounds_select" on public.offer_rounds
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('offers'::text, 'view'::text)));

alter policy "identity_offers_delete" on public.offers
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('offers'::text, 'delete'::text)));

alter policy "identity_offers_insert" on public.offers
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('offers'::text, 'create'::text)));

alter policy "identity_offers_select" on public.offers
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('offers'::text, 'view'::text)));

alter policy "identity_offers_update" on public.offers
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('offers'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('offers'::text, 'edit'::text)));

alter policy "workflow_open_house_visitors_delete" on public.open_house_visitors
  using ((EXISTS ( SELECT 1
   FROM open_houses oh
  WHERE ((oh.id = open_house_visitors.open_house_id) AND (oh.tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'delete'::text)))));

alter policy "workflow_open_house_visitors_insert" on public.open_house_visitors
  with check ((EXISTS ( SELECT 1
   FROM open_houses oh
  WHERE ((oh.id = open_house_visitors.open_house_id) AND (oh.tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'create'::text)))));

alter policy "workflow_open_house_visitors_select" on public.open_house_visitors
  using ((EXISTS ( SELECT 1
   FROM open_houses oh
  WHERE ((oh.id = open_house_visitors.open_house_id) AND (oh.tenant_id = current_active_tenant_id()) AND (has_effective_permission('open_house'::text, 'view'::text) OR has_effective_permission('customers'::text, 'create'::text))))));

alter policy "workflow_open_house_visitors_update" on public.open_house_visitors
  using ((EXISTS ( SELECT 1
   FROM open_houses oh
  WHERE ((oh.id = open_house_visitors.open_house_id) AND (oh.tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'edit'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM open_houses oh
  WHERE ((oh.id = open_house_visitors.open_house_id) AND (oh.tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'edit'::text)))));

alter policy "workflow_open_houses_delete" on public.open_houses
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'delete'::text)));

alter policy "workflow_open_houses_insert" on public.open_houses
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'create'::text)));

alter policy "workflow_open_houses_select" on public.open_houses
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'view'::text)));

alter policy "workflow_open_houses_update" on public.open_houses
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('open_house'::text, 'edit'::text)));

alter policy "capability_owner_portal_delete" on public.owner_portal_tokens
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "capability_owner_portal_insert" on public.owner_portal_tokens
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "capability_owner_portal_select" on public.owner_portal_tokens
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'view'::text)));

alter policy "capability_owner_portal_update" on public.owner_portal_tokens
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "workflow_payment_links_select" on public.payment_links
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'view'::text)));

alter policy "platform_announcements_staff_read" on public.platform_announcements
  using (is_platform_staff());

alter policy "playbook_runs_tenant" on public.playbook_runs
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "playbook_steps_tenant" on public.playbook_steps
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "playbooks_tenant" on public.playbooks
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "identity_portal_listings_delete" on public.portal_listings
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('portals'::text, 'delete'::text)));

alter policy "identity_portal_listings_insert" on public.portal_listings
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('portals'::text, 'create'::text)));

alter policy "identity_portal_listings_select" on public.portal_listings
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('portals'::text, 'view'::text)));

alter policy "identity_portal_listings_update" on public.portal_listings
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('portals'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('portals'::text, 'edit'::text)));

alter policy "capability_portal_match_feedback_select" on public.portal_match_feedback
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'view'::text)));

alter policy "presentations_tenant" on public.presentations
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "identity_profiles_platform_select" on public.profiles
  using ((is_platform_staff() AND (COALESCE(((auth.jwt() -> 'app_metadata'::text) ->> 'impersonating'::text), 'false'::text) <> 'true'::text)));

alter policy "identity_profiles_self_update" on public.profiles
  using (((id = auth.uid()) AND (tenant_id = current_active_tenant_id())))
  with check (((id = auth.uid()) AND (tenant_id = current_active_tenant_id())));

alter policy "identity_profiles_team_delete" on public.profiles
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('team'::text, 'delete'::text)));

alter policy "identity_profiles_team_insert" on public.profiles
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('team'::text, 'create'::text)));

alter policy "identity_profiles_team_update" on public.profiles
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('team'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('team'::text, 'edit'::text)));

alter policy "identity_profiles_tenant_select" on public.profiles
  using ((tenant_id = current_active_tenant_id()));

alter policy "workflow_project_units_delete" on public.project_units
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'delete'::text)));

alter policy "workflow_project_units_insert" on public.project_units
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'create'::text)));

alter policy "workflow_project_units_select" on public.project_units
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'view'::text)));

alter policy "workflow_project_units_update" on public.project_units
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'edit'::text)));

alter policy "identity_projects_delete" on public.projects
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'delete'::text)));

alter policy "identity_projects_insert" on public.projects
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'create'::text)));

alter policy "identity_projects_select" on public.projects
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'view'::text)));

alter policy "identity_projects_update" on public.projects
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('projects'::text, 'edit'::text)));

alter policy "identity_properties_delete" on public.properties
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'delete'::text)));

alter policy "identity_properties_insert" on public.properties
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'create'::text)));

alter policy "identity_properties_select" on public.properties
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'view'::text)));

alter policy "identity_properties_update" on public.properties
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "property_dues_tenant" on public.property_dues
  using ((tenant_id = current_tenant_id()));

alter policy "property_dues_tenant_insert" on public.property_dues
  with check ((tenant_id = current_tenant_id()));

alter policy "property_dues_tenant_update" on public.property_dues
  using ((tenant_id = current_tenant_id()));

alter policy "property_key_events_tenant_delete" on public.property_key_events
  using ((tenant_id = current_tenant_id()));

alter policy "property_key_events_tenant_insert" on public.property_key_events
  with check ((tenant_id = current_tenant_id()));

alter policy "property_key_events_tenant_select" on public.property_key_events
  using ((tenant_id = current_tenant_id()));

alter policy "property_keys_tenant_delete" on public.property_keys
  using ((tenant_id = current_tenant_id()));

alter policy "property_keys_tenant_insert" on public.property_keys
  with check ((tenant_id = current_tenant_id()));

alter policy "property_keys_tenant_select" on public.property_keys
  using ((tenant_id = current_tenant_id()));

alter policy "property_keys_tenant_update" on public.property_keys
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "identity_property_media_delete" on public.property_media
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "identity_property_media_insert" on public.property_media
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid))));

alter policy "identity_property_media_select" on public.property_media
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'view'::text)));

alter policy "identity_property_media_update" on public.property_media
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "pph_tenant" on public.property_price_history
  using ((tenant_id = current_tenant_id()));

alter policy "pph_tenant_insert" on public.property_price_history
  with check ((tenant_id = current_tenant_id()));

alter policy "workflow_property_history_select" on public.property_status_history
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'view'::text)));

alter policy "capability_referral_links_delete" on public.referral_links
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'delete'::text)));

alter policy "capability_referral_links_insert" on public.referral_links
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)));

alter policy "capability_referral_links_select" on public.referral_links
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'view'::text)));

alter policy "capability_referral_links_update" on public.referral_links
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)));

alter policy "capability_referrals_delete" on public.referrals
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'delete'::text)));

alter policy "capability_referrals_insert" on public.referrals
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'edit'::text)));

alter policy "capability_referrals_select" on public.referrals
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('customers'::text, 'view'::text)));

alter policy "capability_referrals_update" on public.referrals
  using (((tenant_id = current_active_tenant_id()) AND (has_effective_permission('customers'::text, 'edit'::text) OR has_effective_permission('customers'::text, 'create'::text))))
  with check (((tenant_id = current_active_tenant_id()) AND (has_effective_permission('customers'::text, 'edit'::text) OR has_effective_permission('customers'::text, 'create'::text))));

alter policy "region_stats_history_tenant_read" on public.region_stats_history
  using ((tenant_id = current_tenant_id()));

alter policy "workflow_rent_charges_delete" on public.rent_charges
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'delete'::text)));

alter policy "workflow_rent_charges_insert" on public.rent_charges
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'create'::text)));

alter policy "workflow_rent_charges_select" on public.rent_charges
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'view'::text)));

alter policy "workflow_rent_charges_update" on public.rent_charges
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'edit'::text)));

alter policy "identity_rentals_delete" on public.rentals
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'delete'::text)));

alter policy "identity_rentals_insert" on public.rentals
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'create'::text)));

alter policy "identity_rentals_select" on public.rentals
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'view'::text)));

alter policy "identity_rentals_update" on public.rentals
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('rentals'::text, 'edit'::text)));

alter policy "saved_views_own" on public.saved_views
  using (((tenant_id = current_tenant_id()) AND (user_id = auth.uid())))
  with check (((tenant_id = current_tenant_id()) AND (user_id = auth.uid())));

alter policy "capability_share_links_delete" on public.share_links
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "capability_share_links_insert" on public.share_links
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "capability_share_links_select" on public.share_links
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'view'::text)));

alter policy "capability_share_links_update" on public.share_links
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('properties'::text, 'edit'::text)));

alter policy "staff_leaves_tenant" on public.staff_leaves
  using ((tenant_id = current_tenant_id()))
  with check ((tenant_id = current_tenant_id()));

alter policy "subscriptions_staff_update" on public.subscriptions
  using (is_platform_staff())
  with check (is_platform_staff());

alter policy "subscriptions_tenant_select" on public.subscriptions
  using (((tenant_id = current_tenant_id()) OR is_platform_staff()));

alter policy "capability_surveys_delete" on public.surveys
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('reports'::text, 'delete'::text)));

alter policy "capability_surveys_insert" on public.surveys
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('reports'::text, 'view'::text) AND has_effective_permission('commissions'::text, 'view'::text)));

alter policy "capability_surveys_select" on public.surveys
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('reports'::text, 'view'::text)));

alter policy "capability_surveys_update" on public.surveys
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('reports'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('reports'::text, 'edit'::text)));

alter policy "workflow_targets_delete" on public.targets
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'delete'::text)));

alter policy "workflow_targets_insert" on public.targets
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'create'::text)));

alter policy "workflow_targets_select" on public.targets
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'view'::text)));

alter policy "workflow_targets_update" on public.targets
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'edit'::text)));

alter policy "identity_tasks_delete" on public.tasks
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('tasks'::text, 'delete'::text)));

alter policy "identity_tasks_insert" on public.tasks
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('tasks'::text, 'create'::text)));

alter policy "identity_tasks_select" on public.tasks
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('tasks'::text, 'view'::text)));

alter policy "identity_tasks_update" on public.tasks
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('tasks'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('tasks'::text, 'edit'::text)));

alter policy "tenant_advisor_messages_own" on public.tenant_advisor_messages
  using ((session_id IN ( SELECT tenant_advisor_sessions.id
   FROM tenant_advisor_sessions
  WHERE ((tenant_advisor_sessions.tenant_id = current_tenant_id()) AND (tenant_advisor_sessions.user_id = auth.uid())))))
  with check ((session_id IN ( SELECT tenant_advisor_sessions.id
   FROM tenant_advisor_sessions
  WHERE ((tenant_advisor_sessions.tenant_id = current_tenant_id()) AND (tenant_advisor_sessions.user_id = auth.uid())))));

alter policy "tenant_advisor_sessions_own" on public.tenant_advisor_sessions
  using (((tenant_id = current_tenant_id()) AND (user_id = auth.uid())))
  with check (((tenant_id = current_tenant_id()) AND (user_id = auth.uid())));

alter policy "tenant_integrations_read" on public.tenant_integrations
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));

alter policy "tenant_role_permissions_read" on public.tenant_role_permissions
  using ((tenant_id = current_tenant_id()));

alter policy "tenant_role_permissions_write" on public.tenant_role_permissions
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))))
  with check (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));

alter policy "identity_tenants_select" on public.tenants
  using (((((id)::text = NULLIF(btrim(((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text)), ''::text)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_active = true) AND (p.tenant_id = tenants.id) AND (p.role = NULLIF(btrim(((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text)), ''::text)))))) OR (id = current_active_tenant_id()) OR (is_platform_staff() AND (COALESCE(((auth.jwt() -> 'app_metadata'::text) ->> 'impersonating'::text), 'false'::text) <> 'true'::text))));

alter policy "identity_tenants_update" on public.tenants
  using ((((id = current_active_tenant_id()) AND has_effective_permission('settings'::text, 'edit'::text)) OR (is_platform_staff() AND (COALESCE(((auth.jwt() -> 'app_metadata'::text) ->> 'impersonating'::text), 'false'::text) <> 'true'::text))))
  with check ((((id = current_active_tenant_id()) AND has_effective_permission('settings'::text, 'edit'::text)) OR (is_platform_staff() AND (COALESCE(((auth.jwt() -> 'app_metadata'::text) ->> 'impersonating'::text), 'false'::text) <> 'true'::text))));

alter policy "ticket_macros_staff_select" on public.ticket_macros
  using (is_platform_staff());

alter policy "unit_payments_tenant" on public.unit_payments
  using ((tenant_id = current_tenant_id()));

alter policy "unit_payments_tenant_insert" on public.unit_payments
  with check ((tenant_id = current_tenant_id()));

alter policy "user_permission_overrides_read" on public.user_permission_overrides
  using ((tenant_id = current_tenant_id()));

alter policy "user_permission_overrides_write" on public.user_permission_overrides
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))))
  with check (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));

alter policy "capability_valuations_delete" on public.valuations
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('valuation'::text, 'delete'::text)));

alter policy "capability_valuations_insert" on public.valuations
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('valuation'::text, 'create'::text)));

alter policy "capability_valuations_select" on public.valuations
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('valuation'::text, 'view'::text)));

alter policy "capability_valuations_update" on public.valuations
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('valuation'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('valuation'::text, 'edit'::text)));

alter policy "vitrin_price_alerts_tenant_read" on public.vitrin_price_alerts
  using ((tenant_id = current_tenant_id()));

alter policy "vitrin_saved_searches_tenant_read" on public.vitrin_saved_searches
  using ((tenant_id = current_tenant_id()));

commit;
