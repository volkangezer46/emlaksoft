-- MIGRATION 20261013000200_rls_initplan_fsbo_staff.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi:
--   scripts/db-shadow-replay.sh).
-- Geri alma: supabase/rollbacks/20261013000200_rls_initplan_fsbo_staff.rollback.sql (eski ifadeler birebir, gölgeden deparse).
-- BAGIMLILIK: 20261012002800_fsbo_select_scope.sql (fsbo_leads_select / alt tablo SELECT ifadeleri orada son halini aldi),
--   20261012002600_fsbo_rls_scope.sql (fsbo_leads_update), destek v2 politikalari, platform personeli politikalari.
--
-- AMAC (HIZ, DB-1): 20261009000400 sonrasi eklenen politikalarda CIPLAK STABLE yardimci cagrilari satir basina calisiyor.
--   Olcum (canli, 2000 cagri, authenticated+gercek claim): has_effective_permission 215 us/cagri, current_tenant_id 39 us,
--   fsbo_office_wide_role 64 us, is_platform_staff 14 us; (select ...) ile sarili hali 2000 satirda toplam 0,8 ms.
--   EXPLAIN: fsbo_leads/fsbo_lead_activities Filter'inda has_effective_permission() InitPlan DEGIL, satir filtresi.
-- ANLAM AYNI: yalniz satir-bagimsiz cagrilar (argumansiz ya da sabit argumanli) (select fn()) ile sarilir -> sorgu basina
--   1 InitPlan. Satir argumani alan cagrilar (support_tenant_can_read_ticket(t.tenant_id,..), custom_field_can_write(entity,..),
--   survey_can_work_task(task_id)) DOKUNULMAZ. ALTER POLICY: rol (TO ...), ad, komut ve permissive degismez; 'TO authenticated'
--   EKLENMEZ.
-- DOGRULAMA (gölge): sarma acildiginda (( SELECT f() AS f) -> f()) her ifade eski deparse ile birebir aynidir.
set local lock_timeout = '5s';

-- ---------- FSBO (Sahibinden ilanlar) ----------
-- fsbo_leads_select: 20261012002800 ifadesi (danisman kapsami: kendi + sahipsiz + kendi olusturdugu).
alter policy fsbo_leads_select on public.fsbo_leads
  using ((tenant_id = (select public.current_tenant_id()))
     and (select public.has_effective_permission('prospecting','view'))
     and ((select public.fsbo_office_wide_role()) or assigned_to is null
          or assigned_to = (select auth.uid()) or created_by = (select auth.uid())));
alter policy fsbo_leads_insert on public.fsbo_leads
  with check ((tenant_id = (select public.current_tenant_id()))
     and (select public.has_effective_permission('prospecting','create'))
     and coalesce(is_sample, false) = false);
alter policy fsbo_leads_update on public.fsbo_leads
  using ((tenant_id = (select public.current_tenant_id()))
     and (select public.has_effective_permission('prospecting','edit'))
     and (((select public.current_profile_role()) = any (array['owner','gm','branch_manager','team_lead']))
          or assigned_to is null or assigned_to = (select auth.uid())
          or (claim_expires_at is not null and claim_expires_at <= now())
          or last_activity_at <= now() - interval '14 days'))
  with check ((tenant_id = (select public.current_tenant_id()))
     and (select public.has_effective_permission('prospecting','edit'))
     and (((select public.current_profile_role()) = any (array['owner','gm','branch_manager','team_lead']))
          or assigned_to is null or assigned_to = (select auth.uid())));
alter policy fsbo_leads_delete on public.fsbo_leads
  using ((tenant_id = (select public.current_tenant_id())) and (select public.has_effective_permission('prospecting','delete')));

alter policy fsbo_dnc_select on public.fsbo_do_not_call
  using ((tenant_id = (select public.current_tenant_id())) and (select public.has_effective_permission('prospecting','view')));
alter policy fsbo_dnc_insert on public.fsbo_do_not_call
  with check ((tenant_id = (select public.current_tenant_id())) and (select public.has_effective_permission('prospecting','edit')));
alter policy fsbo_dnc_delete on public.fsbo_do_not_call
  using ((tenant_id = (select public.current_tenant_id())) and (select public.has_effective_permission('prospecting','delete')));

alter policy fsbo_activities_select on public.fsbo_lead_activities
  using ((tenant_id = (select public.current_tenant_id())) and (select public.has_effective_permission('prospecting','view'))
     and exists (select 1 from public.fsbo_leads l where l.id = fsbo_lead_activities.lead_id and l.tenant_id = fsbo_lead_activities.tenant_id));
alter policy fsbo_activities_insert on public.fsbo_lead_activities
  with check ((tenant_id = (select public.current_tenant_id())) and (select public.has_effective_permission('prospecting','edit'))
     and exists (select 1 from public.fsbo_leads l where l.id = fsbo_lead_activities.lead_id and l.tenant_id = fsbo_lead_activities.tenant_id));
alter policy fsbo_observations_select on public.fsbo_lead_observations
  using ((tenant_id = (select public.current_tenant_id())) and (select public.has_effective_permission('prospecting','view'))
     and exists (select 1 from public.fsbo_leads l where l.id = fsbo_lead_observations.lead_id and l.tenant_id = fsbo_lead_observations.tenant_id));
alter policy fsbo_observations_insert on public.fsbo_lead_observations
  with check ((tenant_id = (select public.current_tenant_id())) and (select public.has_effective_permission('prospecting','create'))
     and exists (select 1 from public.fsbo_leads l where l.id = fsbo_lead_observations.lead_id and l.tenant_id = fsbo_lead_observations.tenant_id));

-- ---------- Platform personeli politikalari (is_platform_staff satir basina) ----------
alter policy compliance_ledger_entries_staff  on public.compliance_ledger_entries  using ((select public.is_platform_staff()));
alter policy compliance_ledger_settings_staff on public.compliance_ledger_settings using ((select public.is_platform_staff()));
alter policy document_request_files_staff on public.document_request_files using ((select public.is_platform_staff())) with check ((select public.is_platform_staff()));
alter policy document_requests_staff      on public.document_requests      using ((select public.is_platform_staff())) with check ((select public.is_platform_staff()));
alter policy kvkk_requests_staff          on public.kvkk_requests          using ((select public.is_platform_staff())) with check ((select public.is_platform_staff()));
alter policy oversight_alert_reviews_staff on public.oversight_alert_reviews using ((select public.is_platform_staff())) with check ((select public.is_platform_staff()));
alter policy oversight_settings_staff     on public.oversight_settings     using ((select public.is_platform_staff())) with check ((select public.is_platform_staff()));
alter policy ownership_transfers_staff    on public.ownership_transfers    using ((select public.is_platform_staff()));
alter policy settings_history_platform_select on public.settings_history using (scope = 'platform' and (select public.is_platform_staff()));

-- ---------- Destek: yalniz satir-bagimsiz support_is_ticket_staff() sarilir ----------
alter policy support_tickets_tenant_select_v2 on public.support_tickets
  using ((select public.support_is_ticket_staff()) or public.support_tenant_can_read_ticket(tenant_id, created_by));
alter policy support_ticket_csat_tenant_select_v2 on public.support_ticket_csat
  using ((select public.support_is_ticket_staff()) or exists (select 1 from public.support_tickets t
         where t.id = support_ticket_csat.ticket_id and public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)));
alter policy support_ticket_events_tenant_select_v2 on public.support_ticket_events
  using ((select public.support_is_ticket_staff()) or exists (select 1 from public.support_tickets t
         where t.id = support_ticket_events.ticket_id and support_ticket_events.visibility = 'public'
           and public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)));
alter policy support_ticket_messages_select_v2 on public.support_ticket_messages
  using (exists (select 1 from public.support_tickets t where t.id = support_ticket_messages.ticket_id
         and ((select public.support_is_ticket_staff())
              or (support_ticket_messages.visibility = 'public' and public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)))));

-- DOGRULAMA (uygulama sonrasi salt-okunur): bu 24 politikada ciplak (SELECT'siz) has_effective_permission /
-- current_tenant_id / fsbo_office_wide_role / is_platform_staff / support_is_ticket_staff kalmamali:
-- select tablename, policyname from pg_policies where schemaname = 'public'
--   and (tablename like 'fsbo%' or policyname like '%\_staff' or tablename like 'support%')
--   and coalesce(qual, '') || coalesce(with_check, '')
--       ~ '(?<!SELECT )(public\.)?(has_effective_permission|current_tenant_id|fsbo_office_wide_role|is_platform_staff|support_is_ticket_staff)\(';
