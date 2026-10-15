-- MIGRATION 20261016100100_rls_module_write_policies.sql
-- SK10 / B159 + B182 (2026-10-16): yalniz tenant_id kosulu tasiyan yazma politikalarina MODUL IZNI eklenir.
-- Geri alma: supabase/rollbacks/20261016100100_rls_module_write_policies.rollback.sql (politikalar eski tenant-only
--   bicimine, cron tablolarinin yazma yetkileri geri gelir; veri degismez).
-- BAGIMLILIK: has_effective_permission(text,text), current_tenant_id(), auth.uid(); ilgili tablolar (hepsi mevcut).
--
-- NE (tablo -> yazma kosulu; uygulamadaki eylem kapisinin AYNISI, daha gevsek degil):
--   announcements, automations, contract_templates, definitions, lookup_values, message_templates,
--   playbooks, playbook_steps                         -> settings:edit
--   approval_comments                                -> ekleme commissions:view + author_id = kullanici; duzeltme/silme yalniz yazari
--   campaign_recipients                              -> ekleme campaigns:create, guncelleme/silme campaigns:edit
--   lost_sale_dismissals                             -> customers:edit
--   network_demands, network_listings                -> ekleme network:create, guncelleme/silme network:edit
--   network_requests, network_demand_responses       -> ekleme network:create, yanit/geri cekme network:edit
--   presentations                                    -> ekleme properties:view + created_by = kullanici, guncelleme/silme properties:edit
--   property_dues                                    -> expenses:create / edit / delete
--   property_keys, property_key_events               -> properties:edit (silme properties:delete)
--   rent_reminders (ofis kanali guncelleme)          -> rentals:edit
--   staff_leaves                                     -> team:edit; ya da team:view + kendi adina 'talep'
--   unit_payments                                    -> projects:edit
--   agent_badges, agent_score_snapshots, automation_logs, playbook_runs: YALNIZ cron/sunucu (service_role) yazar ->
--     authenticated/anon'un INSERT/UPDATE/DELETE yetkisi REVOKE; okuma politikasi (tenant) korunur.
-- "ALL" politikalari SELECT + yazma politikalarina ayrilir: okuma kosulu (tenant) birebir korunur, realtime/okuma degismez.
-- notifications / notification_reads'e dokunulmaz (sozlesme h). survey_* (survey_is_manager) ve custom_field_values
--   (custom_field_can_write) zaten rol/izin kosulu tasir.
-- KAPI: scripts/rls-audit.ts "YAZMA-IZIN-YOK" kurali bu sinifi yeniden yakalar.
-- Idempotent: drop policy if exists + create; revoke tekrarlanabilir.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null then
    raise exception 'has_effective_permission yok.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Yalniz cron/sunucu yazar: yazma yetkisi kalkar, okuma politikasi korunur.
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists agent_badges_tenant on public.agent_badges;
drop policy if exists agent_badges_select on public.agent_badges;
create policy agent_badges_select on public.agent_badges
  for select using (tenant_id = (select public.current_tenant_id()));
revoke insert, update, delete on public.agent_badges from anon, authenticated;

drop policy if exists agent_score_snapshots_tenant on public.agent_score_snapshots;
drop policy if exists agent_score_snapshots_select on public.agent_score_snapshots;
create policy agent_score_snapshots_select on public.agent_score_snapshots
  for select using (tenant_id = (select public.current_tenant_id()));
revoke insert, update, delete on public.agent_score_snapshots from anon, authenticated;

drop policy if exists automation_logs_tenant on public.automation_logs;
drop policy if exists automation_logs_select on public.automation_logs;
create policy automation_logs_select on public.automation_logs
  for select using (tenant_id = (select public.current_tenant_id()));
revoke insert, update, delete on public.automation_logs from anon, authenticated;

drop policy if exists playbook_runs_tenant on public.playbook_runs;
drop policy if exists playbook_runs_select on public.playbook_runs;
create policy playbook_runs_select on public.playbook_runs
  for select using (tenant_id = (select public.current_tenant_id()));
revoke insert, update, delete on public.playbook_runs from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- settings:edit
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists announcements_tenant_insert on public.announcements;
create policy announcements_tenant_insert on public.announcements
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists announcements_tenant_update on public.announcements;
create policy announcements_tenant_update on public.announcements
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists announcements_tenant_delete on public.announcements;
create policy announcements_tenant_delete on public.announcements
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists automations_tenant on public.automations;
drop policy if exists automations_select on public.automations;
create policy automations_select on public.automations
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists automations_insert on public.automations;
create policy automations_insert on public.automations
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists automations_update on public.automations;
create policy automations_update on public.automations
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists automations_delete on public.automations;
create policy automations_delete on public.automations
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists contract_templates_insert on public.contract_templates;
create policy contract_templates_insert on public.contract_templates
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists contract_templates_update on public.contract_templates;
create policy contract_templates_update on public.contract_templates
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists contract_templates_delete on public.contract_templates;
create policy contract_templates_delete on public.contract_templates
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists definitions_insert on public.definitions;
create policy definitions_insert on public.definitions
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists definitions_update on public.definitions;
create policy definitions_update on public.definitions
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists definitions_delete on public.definitions;
create policy definitions_delete on public.definitions
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists lookup_values_insert on public.lookup_values;
create policy lookup_values_insert on public.lookup_values
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists lookup_values_update on public.lookup_values;
create policy lookup_values_update on public.lookup_values
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and is_system = false and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists lookup_values_delete on public.lookup_values;
create policy lookup_values_delete on public.lookup_values
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and is_system = false and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists message_templates_tenant_insert on public.message_templates;
create policy message_templates_tenant_insert on public.message_templates
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists message_templates_tenant_update on public.message_templates;
create policy message_templates_tenant_update on public.message_templates
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));
drop policy if exists message_templates_tenant_delete on public.message_templates;
create policy message_templates_tenant_delete on public.message_templates
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists playbooks_tenant on public.playbooks;
drop policy if exists playbooks_select on public.playbooks;
create policy playbooks_select on public.playbooks
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists playbooks_write on public.playbooks;
create policy playbooks_write on public.playbooks
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

drop policy if exists playbook_steps_tenant on public.playbook_steps;
drop policy if exists playbook_steps_select on public.playbook_steps;
create policy playbook_steps_select on public.playbook_steps
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists playbook_steps_write on public.playbook_steps;
create policy playbook_steps_write on public.playbook_steps
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('settings', 'edit')));

-- ---------------------------------------------------------------------------------------------------------------
-- approval_comments: ekleme commissions:view + kendi adina; duzeltme/silme yalniz yazari
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists approval_comments_tenant on public.approval_comments;
drop policy if exists approval_comments_select on public.approval_comments;
create policy approval_comments_select on public.approval_comments
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists approval_comments_insert on public.approval_comments;
create policy approval_comments_insert on public.approval_comments
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and author_id = (select auth.uid())
    and (select public.has_effective_permission('commissions', 'view'))
  );
drop policy if exists approval_comments_update on public.approval_comments;
create policy approval_comments_update on public.approval_comments
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and author_id = (select auth.uid()))
  with check (tenant_id = (select public.current_tenant_id()) and author_id = (select auth.uid()));
drop policy if exists approval_comments_delete on public.approval_comments;
create policy approval_comments_delete on public.approval_comments
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- campaign_recipients (kiraci siniri kampanyadan): campaigns:create / edit
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists campaign_recipients_tenant on public.campaign_recipients;
drop policy if exists campaign_recipients_select on public.campaign_recipients;
create policy campaign_recipients_select on public.campaign_recipients
  for select using (campaign_id in (select campaigns.id from public.campaigns where campaigns.tenant_id = (select public.current_tenant_id())));
drop policy if exists campaign_recipients_insert on public.campaign_recipients;
create policy campaign_recipients_insert on public.campaign_recipients
  for insert to authenticated
  with check (
    campaign_id in (select campaigns.id from public.campaigns where campaigns.tenant_id = (select public.current_tenant_id()))
    and (select public.has_effective_permission('campaigns', 'create'))
  );
drop policy if exists campaign_recipients_update on public.campaign_recipients;
create policy campaign_recipients_update on public.campaign_recipients
  for update to authenticated
  using (
    campaign_id in (select campaigns.id from public.campaigns where campaigns.tenant_id = (select public.current_tenant_id()))
    and (select public.has_effective_permission('campaigns', 'edit'))
  )
  with check (
    campaign_id in (select campaigns.id from public.campaigns where campaigns.tenant_id = (select public.current_tenant_id()))
    and (select public.has_effective_permission('campaigns', 'edit'))
  );
drop policy if exists campaign_recipients_delete on public.campaign_recipients;
create policy campaign_recipients_delete on public.campaign_recipients
  for delete to authenticated
  using (
    campaign_id in (select campaigns.id from public.campaigns where campaigns.tenant_id = (select public.current_tenant_id()))
    and (select public.has_effective_permission('campaigns', 'edit'))
  );

-- ---------------------------------------------------------------------------------------------------------------
-- lost_sale_dismissals: customers:edit (upsert = insert + update)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists lsd_tenant on public.lost_sale_dismissals;
drop policy if exists lsd_select on public.lost_sale_dismissals;
create policy lsd_select on public.lost_sale_dismissals
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists lsd_write on public.lost_sale_dismissals;
create policy lsd_write on public.lost_sale_dismissals
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('customers', 'edit')));

-- ---------------------------------------------------------------------------------------------------------------
-- network_*: ekleme network:create, guncelleme/silme/yanit network:edit
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists network_demands_tenant on public.network_demands;
drop policy if exists network_demands_select_own on public.network_demands;
create policy network_demands_select_own on public.network_demands
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists network_demands_tenant_insert on public.network_demands;
create policy network_demands_tenant_insert on public.network_demands
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'create')));
drop policy if exists network_demands_update on public.network_demands;
create policy network_demands_update on public.network_demands
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'edit')));
drop policy if exists network_demands_delete on public.network_demands;
create policy network_demands_delete on public.network_demands
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'edit')));

drop policy if exists network_listings_tenant on public.network_listings;
drop policy if exists network_listings_select_own on public.network_listings;
create policy network_listings_select_own on public.network_listings
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists network_listings_tenant_insert on public.network_listings;
create policy network_listings_tenant_insert on public.network_listings
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'create')));
drop policy if exists network_listings_update on public.network_listings;
create policy network_listings_update on public.network_listings
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'edit')));
drop policy if exists network_listings_delete on public.network_listings;
create policy network_listings_delete on public.network_listings
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'edit')));

drop policy if exists network_requests_insert on public.network_requests;
create policy network_requests_insert on public.network_requests
  for insert to authenticated
  with check (from_tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'create')));
drop policy if exists network_requests_respond on public.network_requests;
create policy network_requests_respond on public.network_requests
  for update to authenticated
  using (to_tenant_id = (select public.current_tenant_id()) and status = 'pending' and (select public.has_effective_permission('network', 'edit')))
  with check (to_tenant_id = (select public.current_tenant_id()) and status = any (array['accepted', 'rejected'])
              and (select public.has_effective_permission('network', 'edit')));
drop policy if exists network_requests_withdraw on public.network_requests;
create policy network_requests_withdraw on public.network_requests
  for update to authenticated
  using (from_tenant_id = (select public.current_tenant_id()) and status = 'pending' and (select public.has_effective_permission('network', 'edit')))
  with check (from_tenant_id = (select public.current_tenant_id()) and status = 'withdrawn'
              and (select public.has_effective_permission('network', 'edit')));

drop policy if exists network_demand_responses_insert on public.network_demand_responses;
create policy network_demand_responses_insert on public.network_demand_responses
  for insert to authenticated
  with check (from_tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('network', 'create')));
drop policy if exists network_demand_responses_respond on public.network_demand_responses;
create policy network_demand_responses_respond on public.network_demand_responses
  for update to authenticated
  using (to_tenant_id = (select public.current_tenant_id()) and status = 'pending' and (select public.has_effective_permission('network', 'edit')))
  with check (to_tenant_id = (select public.current_tenant_id()) and status = any (array['accepted', 'rejected'])
              and (select public.has_effective_permission('network', 'edit')));
drop policy if exists network_demand_responses_withdraw on public.network_demand_responses;
create policy network_demand_responses_withdraw on public.network_demand_responses
  for update to authenticated
  using (from_tenant_id = (select public.current_tenant_id()) and status = 'pending' and (select public.has_effective_permission('network', 'edit')))
  with check (from_tenant_id = (select public.current_tenant_id()) and status = 'withdrawn'
              and (select public.has_effective_permission('network', 'edit')));

-- ---------------------------------------------------------------------------------------------------------------
-- presentations: ekleme properties:view + kendi adina (createPresentation kapisi), guncelleme/silme properties:edit
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists presentations_tenant on public.presentations;
drop policy if exists presentations_select on public.presentations;
create policy presentations_select on public.presentations
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists presentations_insert on public.presentations;
create policy presentations_insert on public.presentations
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.has_effective_permission('properties', 'view'))
  );
drop policy if exists presentations_update on public.presentations;
create policy presentations_update on public.presentations
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'edit')));
drop policy if exists presentations_delete on public.presentations;
create policy presentations_delete on public.presentations
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'edit')));

-- ---------------------------------------------------------------------------------------------------------------
-- property_dues: expenses:create / edit / delete
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists property_dues_tenant on public.property_dues;
drop policy if exists property_dues_select on public.property_dues;
create policy property_dues_select on public.property_dues
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists property_dues_tenant_insert on public.property_dues;
create policy property_dues_tenant_insert on public.property_dues
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('expenses', 'create')));
drop policy if exists property_dues_tenant_update on public.property_dues;
create policy property_dues_tenant_update on public.property_dues
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')));
drop policy if exists property_dues_delete on public.property_dues;
create policy property_dues_delete on public.property_dues
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('expenses', 'delete')));

-- ---------------------------------------------------------------------------------------------------------------
-- property_keys / property_key_events: properties:edit (silme properties:delete)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists property_keys_tenant_insert on public.property_keys;
create policy property_keys_tenant_insert on public.property_keys
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'edit')));
drop policy if exists property_keys_tenant_update on public.property_keys;
create policy property_keys_tenant_update on public.property_keys
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'edit')));
drop policy if exists property_keys_tenant_delete on public.property_keys;
create policy property_keys_tenant_delete on public.property_keys
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'delete')));

drop policy if exists property_key_events_tenant_insert on public.property_key_events;
create policy property_key_events_tenant_insert on public.property_key_events
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'edit')));
drop policy if exists property_key_events_tenant_delete on public.property_key_events;
create policy property_key_events_tenant_delete on public.property_key_events
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('properties', 'delete')));

-- ---------------------------------------------------------------------------------------------------------------
-- rent_reminders (ofis kanali "gonderildi" isareti): rentals:edit
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists rent_reminders_update on public.rent_reminders;
create policy rent_reminders_update on public.rent_reminders
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and channel = 'office' and (select public.has_effective_permission('rentals', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and channel = 'office' and (select public.has_effective_permission('rentals', 'edit')));

-- ---------------------------------------------------------------------------------------------------------------
-- staff_leaves: team:edit; izni olmayan yalniz KENDI adina 'talep' acar (createLeave kurali)
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists staff_leaves_tenant on public.staff_leaves;
drop policy if exists staff_leaves_select on public.staff_leaves;
create policy staff_leaves_select on public.staff_leaves
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists staff_leaves_insert on public.staff_leaves;
create policy staff_leaves_insert on public.staff_leaves
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.has_effective_permission('team', 'edit'))
      or ((select public.has_effective_permission('team', 'view')) and staff_id = (select auth.uid()) and status = 'talep')
    )
  );
drop policy if exists staff_leaves_update on public.staff_leaves;
create policy staff_leaves_update on public.staff_leaves
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('team', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('team', 'edit')));
drop policy if exists staff_leaves_delete on public.staff_leaves;
create policy staff_leaves_delete on public.staff_leaves
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('team', 'edit')));

-- ---------------------------------------------------------------------------------------------------------------
-- unit_payments (proje odeme plani): projects:edit
-- ---------------------------------------------------------------------------------------------------------------
drop policy if exists unit_payments_tenant on public.unit_payments;
drop policy if exists unit_payments_select on public.unit_payments;
create policy unit_payments_select on public.unit_payments
  for select using (tenant_id = (select public.current_tenant_id()));
drop policy if exists unit_payments_tenant_insert on public.unit_payments;
create policy unit_payments_tenant_insert on public.unit_payments
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('projects', 'edit')));
drop policy if exists unit_payments_write on public.unit_payments;
create policy unit_payments_write on public.unit_payments
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('projects', 'edit')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('projects', 'edit')));
drop policy if exists unit_payments_delete on public.unit_payments;
create policy unit_payments_delete on public.unit_payments
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.has_effective_permission('projects', 'edit')));
