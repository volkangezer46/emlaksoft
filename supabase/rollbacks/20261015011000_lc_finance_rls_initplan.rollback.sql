-- 20261015011000 geri alma: 6 ilan kontrol + 2 ekstre politikasinin eski ifadeleri (satir basina lc_row_visible /
--   finance_account_access). Gölge zincirinden pg_get_expr ile search_path='' altinda birebir deparse edildi.
--   Ardindan KQ2 kapsam yardimcilari dusurulur (baska nesne kullanmaz). Veri degismez.
set local lock_timeout = '5s';
alter policy listing_anomalies_select on public.listing_anomalies
  using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_effective_permission('portals'::text, 'view'::text) AS has_effective_permission) AND ( SELECT public.lc_row_visible(listing_anomalies.branch_id, listing_anomalies.team_id, listing_anomalies.advisor_id) AS lc_row_visible)));
alter policy listing_control_events_select on public.listing_control_events
  using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_effective_permission('portals'::text, 'view'::text) AS has_effective_permission) AND ( SELECT public.lc_row_visible(listing_control_events.branch_id, listing_control_events.team_id, listing_control_events.advisor_id) AS lc_row_visible)));
alter policy listing_verifications_select on public.listing_verifications
  using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_effective_permission('portals'::text, 'view'::text) AS has_effective_permission) AND ( SELECT public.lc_row_visible(listing_verifications.branch_id, listing_verifications.team_id, listing_verifications.advisor_id) AS lc_row_visible)));
alter policy portal_listing_health_select on public.portal_listing_health
  using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_effective_permission('portals'::text, 'view'::text) AS has_effective_permission) AND ( SELECT public.lc_row_visible(portal_listing_health.branch_id, portal_listing_health.team_id, portal_listing_health.advisor_id) AS lc_row_visible)));
alter policy property_control_state_select on public.property_control_state
  using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_effective_permission('portals'::text, 'view'::text) AS has_effective_permission) AND ( SELECT public.lc_row_visible(property_control_state.branch_id, property_control_state.team_id, property_control_state.advisor_id) AS lc_row_visible)));
alter policy lc_lifecycle_events_select on public.lc_lifecycle_events
  using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_effective_permission('portals'::text, 'view'::text) AS has_effective_permission) AND ( SELECT public.lc_row_visible(lc_lifecycle_events.branch_id, lc_lifecycle_events.team_id, lc_lifecycle_events.advisor_id) AS lc_row_visible)));
alter policy finance_statement_imports_select on public.finance_statement_imports
  using (((tenant_id = ( SELECT public.current_active_tenant_id() AS current_active_tenant_id)) AND ( SELECT public.finance_account_access(finance_statement_imports.account_id, 'view'::text) AS finance_account_access)));
alter policy finance_statement_mappings_select on public.finance_statement_mappings
  using (((tenant_id = ( SELECT public.current_active_tenant_id() AS current_active_tenant_id)) AND ( SELECT public.finance_account_access(finance_statement_mappings.account_id, 'view'::text) AS finance_account_access)));

drop function if exists public.lc_scope_sees_all();
drop function if exists public.lc_scope_branch_id();
drop function if exists public.lc_scope_team_id();
drop function if exists public.lc_scope_advisor_id();
