-- ROLLBACK 20261016100100_rls_module_write_policies.sql
-- Yazma politikalari onceki (yalniz tenant_id) bicimine doner; cron tablolarinin authenticated yazma yetkisi geri verilir.
-- GUVENLIK: geri alma B159 acigini yeniden acar (modul izni olmadan yazma). Veri degismez. Idempotent.

set local lock_timeout = '5s';

-- Cron tablolari
drop policy if exists agent_badges_select on public.agent_badges;
drop policy if exists agent_badges_tenant on public.agent_badges;
create policy agent_badges_tenant on public.agent_badges
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
grant insert, update, delete on public.agent_badges to authenticated;

drop policy if exists agent_score_snapshots_select on public.agent_score_snapshots;
drop policy if exists agent_score_snapshots_tenant on public.agent_score_snapshots;
create policy agent_score_snapshots_tenant on public.agent_score_snapshots
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
grant insert, update, delete on public.agent_score_snapshots to authenticated;

drop policy if exists automation_logs_select on public.automation_logs;
drop policy if exists automation_logs_tenant on public.automation_logs;
create policy automation_logs_tenant on public.automation_logs using (tenant_id = (select public.current_tenant_id()));
grant insert, update, delete on public.automation_logs to authenticated;

drop policy if exists playbook_runs_select on public.playbook_runs;
drop policy if exists playbook_runs_tenant on public.playbook_runs;
create policy playbook_runs_tenant on public.playbook_runs
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
grant insert, update, delete on public.playbook_runs to authenticated;

-- announcements
drop policy if exists announcements_tenant_insert on public.announcements;
create policy announcements_tenant_insert on public.announcements for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists announcements_tenant_update on public.announcements;
create policy announcements_tenant_update on public.announcements for update
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists announcements_tenant_delete on public.announcements;
create policy announcements_tenant_delete on public.announcements for delete using (tenant_id = (select public.current_tenant_id()));

-- automations
drop policy if exists automations_select on public.automations;
drop policy if exists automations_delete on public.automations;
drop policy if exists automations_tenant on public.automations;
create policy automations_tenant on public.automations using (tenant_id = (select public.current_tenant_id()));
drop policy if exists automations_insert on public.automations;
create policy automations_insert on public.automations for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists automations_update on public.automations;
create policy automations_update on public.automations for update using (tenant_id = (select public.current_tenant_id()));

-- contract_templates
drop policy if exists contract_templates_insert on public.contract_templates;
create policy contract_templates_insert on public.contract_templates for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists contract_templates_update on public.contract_templates;
create policy contract_templates_update on public.contract_templates for update
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists contract_templates_delete on public.contract_templates;
create policy contract_templates_delete on public.contract_templates for delete using (tenant_id = (select public.current_tenant_id()));

-- definitions
drop policy if exists definitions_insert on public.definitions;
create policy definitions_insert on public.definitions for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists definitions_update on public.definitions;
create policy definitions_update on public.definitions for update using (tenant_id = (select public.current_tenant_id()));
drop policy if exists definitions_delete on public.definitions;
create policy definitions_delete on public.definitions for delete using (tenant_id = (select public.current_tenant_id()));

-- lookup_values
drop policy if exists lookup_values_insert on public.lookup_values;
create policy lookup_values_insert on public.lookup_values for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists lookup_values_update on public.lookup_values;
create policy lookup_values_update on public.lookup_values for update
  using (tenant_id = (select public.current_tenant_id()) and is_system = false);
drop policy if exists lookup_values_delete on public.lookup_values;
create policy lookup_values_delete on public.lookup_values for delete
  using (tenant_id = (select public.current_tenant_id()) and is_system = false);

-- message_templates
drop policy if exists message_templates_tenant_insert on public.message_templates;
create policy message_templates_tenant_insert on public.message_templates for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists message_templates_tenant_update on public.message_templates;
create policy message_templates_tenant_update on public.message_templates for update
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists message_templates_tenant_delete on public.message_templates;
create policy message_templates_tenant_delete on public.message_templates for delete using (tenant_id = (select public.current_tenant_id()));

-- playbooks / playbook_steps
drop policy if exists playbooks_select on public.playbooks;
drop policy if exists playbooks_write on public.playbooks;
drop policy if exists playbooks_tenant on public.playbooks;
create policy playbooks_tenant on public.playbooks
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists playbook_steps_select on public.playbook_steps;
drop policy if exists playbook_steps_write on public.playbook_steps;
drop policy if exists playbook_steps_tenant on public.playbook_steps;
create policy playbook_steps_tenant on public.playbook_steps
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));

-- approval_comments
drop policy if exists approval_comments_select on public.approval_comments;
drop policy if exists approval_comments_insert on public.approval_comments;
drop policy if exists approval_comments_update on public.approval_comments;
drop policy if exists approval_comments_delete on public.approval_comments;
drop policy if exists approval_comments_tenant on public.approval_comments;
create policy approval_comments_tenant on public.approval_comments
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));

-- campaign_recipients
drop policy if exists campaign_recipients_select on public.campaign_recipients;
drop policy if exists campaign_recipients_update on public.campaign_recipients;
drop policy if exists campaign_recipients_delete on public.campaign_recipients;
drop policy if exists campaign_recipients_tenant on public.campaign_recipients;
create policy campaign_recipients_tenant on public.campaign_recipients
  using (campaign_id in (select campaigns.id from public.campaigns where campaigns.tenant_id = (select public.current_tenant_id())));
drop policy if exists campaign_recipients_insert on public.campaign_recipients;
create policy campaign_recipients_insert on public.campaign_recipients for insert
  with check (campaign_id in (select campaigns.id from public.campaigns where campaigns.tenant_id = (select public.current_tenant_id())));

-- lost_sale_dismissals
drop policy if exists lsd_select on public.lost_sale_dismissals;
drop policy if exists lsd_write on public.lost_sale_dismissals;
drop policy if exists lsd_tenant on public.lost_sale_dismissals;
create policy lsd_tenant on public.lost_sale_dismissals
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));

-- network_*
drop policy if exists network_demands_select_own on public.network_demands;
drop policy if exists network_demands_update on public.network_demands;
drop policy if exists network_demands_delete on public.network_demands;
drop policy if exists network_demands_tenant on public.network_demands;
create policy network_demands_tenant on public.network_demands using (tenant_id = (select public.current_tenant_id()));
drop policy if exists network_demands_tenant_insert on public.network_demands;
create policy network_demands_tenant_insert on public.network_demands for insert with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists network_listings_select_own on public.network_listings;
drop policy if exists network_listings_update on public.network_listings;
drop policy if exists network_listings_delete on public.network_listings;
drop policy if exists network_listings_tenant on public.network_listings;
create policy network_listings_tenant on public.network_listings using (tenant_id = (select public.current_tenant_id()));
drop policy if exists network_listings_tenant_insert on public.network_listings;
create policy network_listings_tenant_insert on public.network_listings for insert with check (tenant_id = (select public.current_tenant_id()));

drop policy if exists network_requests_insert on public.network_requests;
create policy network_requests_insert on public.network_requests for insert with check (from_tenant_id = (select public.current_tenant_id()));
drop policy if exists network_requests_respond on public.network_requests;
create policy network_requests_respond on public.network_requests for update
  using (to_tenant_id = (select public.current_tenant_id()) and status = 'pending')
  with check (to_tenant_id = (select public.current_tenant_id()) and status = any (array['accepted', 'rejected']));
drop policy if exists network_requests_withdraw on public.network_requests;
create policy network_requests_withdraw on public.network_requests for update
  using (from_tenant_id = (select public.current_tenant_id()) and status = 'pending')
  with check (from_tenant_id = (select public.current_tenant_id()) and status = 'withdrawn');

drop policy if exists network_demand_responses_insert on public.network_demand_responses;
create policy network_demand_responses_insert on public.network_demand_responses for insert
  with check (from_tenant_id = (select public.current_tenant_id()));
drop policy if exists network_demand_responses_respond on public.network_demand_responses;
create policy network_demand_responses_respond on public.network_demand_responses for update
  using (to_tenant_id = (select public.current_tenant_id()) and status = 'pending')
  with check (to_tenant_id = (select public.current_tenant_id()) and status = any (array['accepted', 'rejected']));
drop policy if exists network_demand_responses_withdraw on public.network_demand_responses;
create policy network_demand_responses_withdraw on public.network_demand_responses for update
  using (from_tenant_id = (select public.current_tenant_id()) and status = 'pending')
  with check (from_tenant_id = (select public.current_tenant_id()) and status = 'withdrawn');

-- presentations
drop policy if exists presentations_select on public.presentations;
drop policy if exists presentations_insert on public.presentations;
drop policy if exists presentations_update on public.presentations;
drop policy if exists presentations_delete on public.presentations;
drop policy if exists presentations_tenant on public.presentations;
create policy presentations_tenant on public.presentations
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));

-- property_dues
drop policy if exists property_dues_select on public.property_dues;
drop policy if exists property_dues_delete on public.property_dues;
drop policy if exists property_dues_tenant on public.property_dues;
create policy property_dues_tenant on public.property_dues using (tenant_id = (select public.current_tenant_id()));
drop policy if exists property_dues_tenant_insert on public.property_dues;
create policy property_dues_tenant_insert on public.property_dues for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists property_dues_tenant_update on public.property_dues;
create policy property_dues_tenant_update on public.property_dues for update using (tenant_id = (select public.current_tenant_id()));

-- property_keys / property_key_events
drop policy if exists property_keys_tenant_insert on public.property_keys;
create policy property_keys_tenant_insert on public.property_keys for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists property_keys_tenant_update on public.property_keys;
create policy property_keys_tenant_update on public.property_keys for update
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists property_keys_tenant_delete on public.property_keys;
create policy property_keys_tenant_delete on public.property_keys for delete using (tenant_id = (select public.current_tenant_id()));
drop policy if exists property_key_events_tenant_insert on public.property_key_events;
create policy property_key_events_tenant_insert on public.property_key_events for insert with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists property_key_events_tenant_delete on public.property_key_events;
create policy property_key_events_tenant_delete on public.property_key_events for delete using (tenant_id = (select public.current_tenant_id()));

-- rent_reminders
drop policy if exists rent_reminders_update on public.rent_reminders;
create policy rent_reminders_update on public.rent_reminders for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and channel = 'office')
  with check (tenant_id = (select public.current_tenant_id()) and channel = 'office');

-- staff_leaves
drop policy if exists staff_leaves_select on public.staff_leaves;
drop policy if exists staff_leaves_insert on public.staff_leaves;
drop policy if exists staff_leaves_update on public.staff_leaves;
drop policy if exists staff_leaves_delete on public.staff_leaves;
drop policy if exists staff_leaves_tenant on public.staff_leaves;
create policy staff_leaves_tenant on public.staff_leaves
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));

-- unit_payments
drop policy if exists unit_payments_select on public.unit_payments;
drop policy if exists unit_payments_write on public.unit_payments;
drop policy if exists unit_payments_delete on public.unit_payments;
drop policy if exists unit_payments_tenant on public.unit_payments;
create policy unit_payments_tenant on public.unit_payments using (tenant_id = (select public.current_tenant_id()));
drop policy if exists unit_payments_tenant_insert on public.unit_payments;
create policy unit_payments_tenant_insert on public.unit_payments for insert with check (tenant_id = (select public.current_tenant_id()));
