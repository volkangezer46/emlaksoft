-- 20261013000300 geri alma. A: dusurulen 11 indeks pg_get_indexdef ciktisiyla (gölge zinciri ve canli ayni tanim);
--   B: eklenen 12 tenant_id indeksi kaldirilir. Yalniz indeks DDL; veri degismez.
set local lock_timeout = '5s';

-- A) kopya indeksleri geri kur
CREATE INDEX IF NOT EXISTS idx_advisor_commission_plans_profile ON public.advisor_commission_plans USING btree (tenant_id, profile_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_agent_score_snapshots_staff ON public.agent_score_snapshots USING btree (tenant_id, staff_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_contract_signers_token ON public.contract_signers USING btree (token);
CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON public.contract_versions USING btree (contract_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_customer_portal_tokens_token ON public.customer_portal_tokens USING btree (token);
CREATE INDEX IF NOT EXISTS idx_owner_portal_tokens_token ON public.owner_portal_tokens USING btree (token);
CREATE INDEX IF NOT EXISTS idx_recurring_occ_rule ON public.recurring_occurrences USING btree (rule_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_rent_charges_rental ON public.rent_charges USING btree (rental_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON public.share_links USING btree (token);
CREATE INDEX IF NOT EXISTS idx_tcmb_rates_date_desc ON public.tcmb_rates USING btree (rate_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_scopes_tenant_user ON public.user_scopes USING btree (tenant_id, user_id);

-- B) eklenen tenant_id indekslerini kaldir
drop index if exists public.idx_direct_file_uploads_tenant;
drop index if exists public.idx_finance_statement_mappings_tenant;
drop index if exists public.idx_lead_capture_token_revocations_tenant;
drop index if exists public.idx_platform_announcements_tenant;
drop index if exists public.idx_public_mutation_outbox_tenant;
drop index if exists public.idx_saved_views_tenant;
drop index if exists public.idx_settings_history_tenant;
drop index if exists public.idx_storage_deletion_outbox_tenant;
drop index if exists public.idx_success_stories_tenant;
drop index if exists public.idx_support_ticket_attachment_uploads_tenant;
drop index if exists public.idx_survey_attempts_tenant;
drop index if exists public.idx_survey_questions_tenant;
