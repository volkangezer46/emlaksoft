-- 20261013000200 geri alma: 24 politikanin sarma oncesi ifadeleri. Gölge zincirinden (20261012002900 sonrasi)
--   pg_get_expr ile search_path='' altinda birebir deparse edildi; elle yazilmadi. ALTER POLICY: rol/ad/komut degismez.
set local lock_timeout = '5s';
alter policy compliance_ledger_entries_staff on public.compliance_ledger_entries
  using (public.is_platform_staff());
alter policy compliance_ledger_settings_staff on public.compliance_ledger_settings
  using (public.is_platform_staff());
alter policy document_request_files_staff on public.document_request_files
  using (public.is_platform_staff())
  with check (public.is_platform_staff());
alter policy document_requests_staff on public.document_requests
  using (public.is_platform_staff())
  with check (public.is_platform_staff());
alter policy fsbo_dnc_delete on public.fsbo_do_not_call
  using (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'delete'::text)));
alter policy fsbo_dnc_insert on public.fsbo_do_not_call
  with check (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'edit'::text)));
alter policy fsbo_dnc_select on public.fsbo_do_not_call
  using (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'view'::text)));
alter policy fsbo_activities_insert on public.fsbo_lead_activities
  with check (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'edit'::text) AND (EXISTS ( SELECT 1
   FROM public.fsbo_leads l
  WHERE ((l.id = fsbo_lead_activities.lead_id) AND (l.tenant_id = fsbo_lead_activities.tenant_id))))));
alter policy fsbo_activities_select on public.fsbo_lead_activities
  using (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'view'::text) AND (EXISTS ( SELECT 1
   FROM public.fsbo_leads l
  WHERE ((l.id = fsbo_lead_activities.lead_id) AND (l.tenant_id = fsbo_lead_activities.tenant_id))))));
alter policy fsbo_observations_insert on public.fsbo_lead_observations
  with check (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'create'::text) AND (EXISTS ( SELECT 1
   FROM public.fsbo_leads l
  WHERE ((l.id = fsbo_lead_observations.lead_id) AND (l.tenant_id = fsbo_lead_observations.tenant_id))))));
alter policy fsbo_observations_select on public.fsbo_lead_observations
  using (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'view'::text) AND (EXISTS ( SELECT 1
   FROM public.fsbo_leads l
  WHERE ((l.id = fsbo_lead_observations.lead_id) AND (l.tenant_id = fsbo_lead_observations.tenant_id))))));
alter policy fsbo_leads_delete on public.fsbo_leads
  using (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'delete'::text)));
alter policy fsbo_leads_insert on public.fsbo_leads
  with check (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'create'::text) AND (COALESCE(is_sample, false) = false)));
alter policy fsbo_leads_select on public.fsbo_leads
  using (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'view'::text) AND (public.fsbo_office_wide_role() OR (assigned_to IS NULL) OR (assigned_to = auth.uid()) OR (created_by = auth.uid()))));
alter policy fsbo_leads_update on public.fsbo_leads
  using (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'edit'::text) AND ((public.current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text, 'branch_manager'::text, 'team_lead'::text])) OR (assigned_to IS NULL) OR (assigned_to = auth.uid()) OR ((claim_expires_at IS NOT NULL) AND (claim_expires_at <= now())) OR (last_activity_at <= (now() - '14 days'::interval)))))
  with check (((tenant_id = public.current_tenant_id()) AND public.has_effective_permission('prospecting'::text, 'edit'::text) AND ((public.current_profile_role() = ANY (ARRAY['owner'::text, 'gm'::text, 'branch_manager'::text, 'team_lead'::text])) OR (assigned_to IS NULL) OR (assigned_to = auth.uid()))));
alter policy kvkk_requests_staff on public.kvkk_requests
  using (public.is_platform_staff())
  with check (public.is_platform_staff());
alter policy oversight_alert_reviews_staff on public.oversight_alert_reviews
  using (public.is_platform_staff())
  with check (public.is_platform_staff());
alter policy oversight_settings_staff on public.oversight_settings
  using (public.is_platform_staff())
  with check (public.is_platform_staff());
alter policy ownership_transfers_staff on public.ownership_transfers
  using (public.is_platform_staff());
alter policy settings_history_platform_select on public.settings_history
  using (((scope = 'platform'::text) AND public.is_platform_staff()));
alter policy support_ticket_csat_tenant_select_v2 on public.support_ticket_csat
  using ((public.support_is_ticket_staff() OR (EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = support_ticket_csat.ticket_id) AND public.support_tenant_can_read_ticket(t.tenant_id, t.created_by))))));
alter policy support_ticket_events_tenant_select_v2 on public.support_ticket_events
  using ((public.support_is_ticket_staff() OR (EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = support_ticket_events.ticket_id) AND (support_ticket_events.visibility = 'public'::text) AND public.support_tenant_can_read_ticket(t.tenant_id, t.created_by))))));
alter policy support_ticket_messages_select_v2 on public.support_ticket_messages
  using ((EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = support_ticket_messages.ticket_id) AND (public.support_is_ticket_staff() OR ((support_ticket_messages.visibility = 'public'::text) AND public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)))))));
alter policy support_tickets_tenant_select_v2 on public.support_tickets
  using ((public.support_is_ticket_staff() OR public.support_tenant_can_read_ticket(tenant_id, created_by)));
