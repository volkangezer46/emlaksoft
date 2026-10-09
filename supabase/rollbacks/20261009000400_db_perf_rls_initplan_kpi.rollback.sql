-- 20261009000200 geri alma: politika govdeleri onceki (ciplak cagri) metne doner, kopya indeksler yeniden kurulur, KPI RPC duser.
set local search_path = public;

drop function if exists public.rental_kpi_snapshot(date);

create index if not exists idx_portal_listings_tenant_status on public.portal_listings (tenant_id, status);
create index if not exists idx_calls_tenant on public.calls (tenant_id, started_at desc);
create index if not exists idx_appointments_tenant_scheduled on public.appointments (tenant_id, scheduled_at);
create index if not exists idx_tasks_tenant_status on public.tasks (tenant_id, status, due_at);
create index if not exists idx_valuations_tenant on public.valuations (tenant_id, created_at desc);
create index if not exists idx_demo_requests_status on public.demo_requests (status, created_at desc);
create index if not exists idx_campaigns_tenant on public.campaigns (tenant_id, created_at desc);
create index if not exists idx_expenses_tenant on public.expenses (tenant_id, expense_date desc);
create index if not exists idx_communications_customer on public.communications (customer_id, created_at desc);
create index if not exists idx_prop_status_history_property on public.property_status_history (property_id, created_at desc);
create index if not exists idx_pph_tenant on public.property_price_history (tenant_id, created_at desc);

alter policy "access_audit_log_read" on public.access_audit_log
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));
alter policy "platform_staff_own_messages" on public.advisor_messages
  using ((session_id IN ( SELECT advisor_sessions.id
   FROM advisor_sessions
  WHERE (advisor_sessions.staff_id = auth.uid()))))
  with check ((session_id IN ( SELECT advisor_sessions.id
   FROM advisor_sessions
  WHERE (advisor_sessions.staff_id = auth.uid()))));
alter policy "platform_staff_own_sessions" on public.advisor_sessions
  using ((staff_id = auth.uid()))
  with check ((staff_id = auth.uid()));
alter policy "announcement_reads_delete" on public.announcement_reads
  using ((user_id = auth.uid()));
alter policy "announcement_reads_insert" on public.announcement_reads
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM announcements a
  WHERE ((a.id = announcement_reads.announcement_id) AND (a.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)))))));
alter policy "announcement_reads_update" on public.announcement_reads
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
alter policy "compliance_ledger_entries_insert" on public.compliance_ledger_entries
  with check (((tenant_id = current_tenant_id()) AND (created_by = auth.uid())));
alter policy "compliance_ledger_entries_select" on public.compliance_ledger_entries
  using (((tenant_id = current_tenant_id()) AND ((current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text])) OR (created_by = auth.uid()))));
alter policy "compliance_ledger_settings_select" on public.compliance_ledger_settings
  using ((tenant_id = current_tenant_id()));
alter policy "compliance_ledger_settings_write" on public.compliance_ledger_settings
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))))
  with check (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));
alter policy "workflow_deal_notes_delete" on public.deal_notes
  using (((tenant_id = ( SELECT current_active_tenant_id() AS current_active_tenant_id)) AND (author_id = auth.uid()) AND ( SELECT has_effective_permission('commissions'::text, 'edit'::text) AS has_effective_permission)));
alter policy "workflow_deal_notes_insert" on public.deal_notes
  with check (((tenant_id = ( SELECT current_active_tenant_id() AS current_active_tenant_id)) AND (author_id = auth.uid()) AND ( SELECT has_effective_permission('commissions'::text, 'edit'::text) AS has_effective_permission)));
alter policy "deal_process_steps_delete" on public.deal_process_steps
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)));
alter policy "deal_process_steps_insert" on public.deal_process_steps
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text) AND (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deal_process_steps.deal_id) AND (d.tenant_id = deal_process_steps.tenant_id))))));
alter policy "deal_process_steps_select" on public.deal_process_steps
  using ((tenant_id = current_active_tenant_id()));
alter policy "deal_process_steps_update" on public.deal_process_steps
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('commissions'::text, 'edit'::text) AND (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deal_process_steps.deal_id) AND (d.tenant_id = deal_process_steps.tenant_id))))));
alter policy "document_request_files_tenant_select" on public.document_request_files
  using ((tenant_id = current_tenant_id()));
alter policy "document_requests_tenant_select" on public.document_requests
  using ((tenant_id = current_tenant_id()));
alter policy "geo_change_requests_insert" on public.geo_change_requests
  with check (((tenant_id = current_tenant_id()) AND ((requested_by IS NULL) OR (requested_by = ( SELECT auth.uid() AS uid))) AND (status = 'pending'::text) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (resolution_note IS NULL)));
alter policy "geo_change_requests_select" on public.geo_change_requests
  using ((tenant_id = current_tenant_id()));
alter policy "growth_referral_codes_own" on public.growth_referral_codes
  using ((tenant_id = current_tenant_id()));
alter policy "kvkk_requests_tenant_select" on public.kvkk_requests
  using ((tenant_id = current_tenant_id()));
alter policy "league_challenges_delete" on public.league_challenges
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'delete'::text)));
alter policy "league_challenges_insert" on public.league_challenges
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'create'::text)));
alter policy "league_challenges_select" on public.league_challenges
  using ((tenant_id = current_active_tenant_id()));
alter policy "league_challenges_update" on public.league_challenges
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'edit'::text)));
alter policy "league_settings_insert" on public.league_settings
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'edit'::text)));
alter policy "league_settings_select" on public.league_settings
  using ((tenant_id = current_active_tenant_id()));
alter policy "league_settings_update" on public.league_settings
  using (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'edit'::text)))
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('targets'::text, 'edit'::text)));
alter policy "listing_analyses_insert" on public.listing_analyses
  with check (((tenant_id = current_active_tenant_id()) AND has_effective_permission('valuation'::text, 'create'::text) AND (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = listing_analyses.property_id) AND (p.tenant_id = listing_analyses.tenant_id))))));
alter policy "listing_analyses_select" on public.listing_analyses
  using ((tenant_id = current_active_tenant_id()));
alter policy "neighborhood_notes_tenant_select" on public.neighborhood_notes
  using ((tenant_id = current_tenant_id()));
alter policy "notifications_tenant_select" on public.notifications
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((user_id IS NULL) OR (user_id = auth.uid()))));
alter policy "notifications_tenant_update" on public.notifications
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((user_id IS NULL) OR (user_id = auth.uid()))))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ((user_id IS NULL) OR (user_id = auth.uid()))));
alter policy "oversight_alert_reviews_insert" on public.oversight_alert_reviews
  with check (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text, 'branch_manager'::text]))));
alter policy "oversight_alert_reviews_select" on public.oversight_alert_reviews
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text, 'branch_manager'::text]))));
alter policy "oversight_settings_insert" on public.oversight_settings
  with check (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));
alter policy "oversight_settings_select" on public.oversight_settings
  using ((tenant_id = current_tenant_id()));
alter policy "oversight_settings_update" on public.oversight_settings
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))))
  with check (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));
alter policy "ownership_transfers_party_select" on public.ownership_transfers
  using (((tenant_id = current_tenant_id()) AND ((from_user_id = ( SELECT auth.uid() AS uid)) OR (to_user_id = ( SELECT auth.uid() AS uid)))));
alter policy "platform_audit_read" on public.platform_audit_logs
  using ((EXISTS ( SELECT 1
   FROM platform_staff ps
  WHERE ((ps.id = auth.uid()) AND (ps.is_active = true)))));
alter policy "platform_notifications_self" on public.platform_notifications
  using ((staff_id = auth.uid()))
  with check ((staff_id = auth.uid()));
alter policy "platform_settings_super_admin" on public.platform_settings
  using ((EXISTS ( SELECT 1
   FROM platform_staff s
  WHERE ((s.id = auth.uid()) AND s.is_active AND (s.role = 'super_admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM platform_staff s
  WHERE ((s.id = auth.uid()) AND s.is_active AND (s.role = 'super_admin'::text)))));
alter policy "platform_staff_self_select" on public.platform_staff
  using ((id = auth.uid()));
alter policy "identity_profiles_self_select" on public.profiles
  using (((id = auth.uid()) AND (is_active = true) AND (((tenant_id)::text = NULLIF(btrim(((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text)), ''::text)) OR (EXISTS ( SELECT 1
   FROM platform_staff ps
  WHERE ((ps.id = auth.uid()) AND (ps.is_active = true)))))));
alter policy "identity_profiles_self_update" on public.profiles
  using (((id = auth.uid()) AND (tenant_id = ( SELECT current_active_tenant_id() AS current_active_tenant_id))))
  with check (((id = auth.uid()) AND (tenant_id = ( SELECT current_active_tenant_id() AS current_active_tenant_id))));
alter policy "saved_views_own" on public.saved_views
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (user_id = auth.uid())))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (user_id = auth.uid())));
alter policy "scope_overrides_read" on public.scope_overrides
  using ((tenant_id = current_tenant_id()));
alter policy "scope_overrides_write" on public.scope_overrides
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))))
  with check (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));
alter policy "settings_history_tenant_select" on public.settings_history
  using (((scope <> 'platform'::text) AND (tenant_id = current_tenant_id())));
alter policy "support_ticket_attachments_select" on public.support_ticket_attachments
  using (((deleted_at IS NULL) AND ((EXISTS ( SELECT 1
   FROM platform_staff ps
  WHERE ((ps.id = auth.uid()) AND (ps.is_active = true) AND (ps.role = ANY (ARRAY['super_admin'::text, 'ops'::text, 'support'::text]))))) OR ((visibility = 'public'::text) AND (EXISTS ( SELECT 1
   FROM support_tickets t
  WHERE ((t.id = support_ticket_attachments.ticket_id) AND support_tenant_can_read_ticket(t.tenant_id, t.created_by))))))));
alter policy "tenant_advisor_messages_own" on public.tenant_advisor_messages
  using ((session_id IN ( SELECT tenant_advisor_sessions.id
   FROM tenant_advisor_sessions
  WHERE ((tenant_advisor_sessions.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (tenant_advisor_sessions.user_id = auth.uid())))))
  with check ((session_id IN ( SELECT tenant_advisor_sessions.id
   FROM tenant_advisor_sessions
  WHERE ((tenant_advisor_sessions.tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (tenant_advisor_sessions.user_id = auth.uid())))));
alter policy "tenant_advisor_sessions_own" on public.tenant_advisor_sessions
  using (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (user_id = auth.uid())))
  with check (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (user_id = auth.uid())));
alter policy "tenant_settings_select" on public.tenant_settings
  using ((tenant_id = current_tenant_id()));
alter policy "identity_tenants_select" on public.tenants
  using (((((id)::text = NULLIF(btrim(((auth.jwt() -> 'app_metadata'::text) ->> 'tenant_id'::text)), ''::text)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_active = true) AND (p.tenant_id = tenants.id) AND (p.role = NULLIF(btrim(((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text)), ''::text)))))) OR (id = ( SELECT current_active_tenant_id() AS current_active_tenant_id)) OR (( SELECT is_platform_staff() AS is_platform_staff) AND (COALESCE(((auth.jwt() -> 'app_metadata'::text) ->> 'impersonating'::text), 'false'::text) <> 'true'::text))));
alter policy "user_scopes_read" on public.user_scopes
  using ((tenant_id = current_tenant_id()));
alter policy "user_scopes_write" on public.user_scopes
  using (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))))
  with check (((tenant_id = current_tenant_id()) AND (current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text]))));
