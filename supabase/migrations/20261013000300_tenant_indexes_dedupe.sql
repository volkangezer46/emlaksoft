-- MIGRATION 20261013000300_tenant_indexes_dedupe.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi).
-- Geri alma: supabase/rollbacks/20261013000300_tenant_indexes_dedupe.rollback.sql
--
-- AMAC (DB-3, indeks hijyeni):
--  A) Benzersiz kisit/PK indeksinin ikizi olan 11 btree indeks dusurulur. Her biri ayni anahtar dizisini (ya da onekini)
--     tasiyan benzersiz indeksle kapsanir; DESC farki onemsiz (btree geriye taranir). Kisit indeksleri DOKUNULMAZ.
--  B) tenant_id'si hicbir indeksin ilk sutunu olmayan 12 tabloya (tenant_id) indeksi eklenir: RLS'teki
--     tenant_id = (select current_tenant_id()) filtresi tam tarama yerine indeksle cozulur.
--  KAPSAM DISI: ON DELETE CASCADE/SET NULL FK indeksleri (~129, taslagin C bolumu) bu dosyada YOK; ayri olcumle ele alinir.
-- KILIT: runner tek transaction -> CONCURRENTLY YOK (20261012002210 ile ayni gerekce). Canli veri kucuk (~41k satir toplam;
--   bu tablolarin en buyugu settings_history ~700 satir), kilit ms mertebesinde. Buyuk veride ayni liste
--   `create index concurrently` / `drop index concurrently` ile elle (psql, transaction disi) uygulanmali.
-- DOGRULAMA (salt-okunur): scratchpad konsey/idx.sql "DUPLICATE INDEXES" ve "TENANT_ID UNINDEXED" bolumleri bos doner.
set local lock_timeout = '5s';

-- A) Kopya indeksler (benzersiz kisitin onek/ayni-anahtar ikizi)
drop index if exists public.idx_advisor_commission_plans_profile;   -- = advisor_commission_plans_unique_start (tenant_id, profile_id, valid_from)
drop index if exists public.idx_agent_score_snapshots_staff;        -- = agent_score_snapshots_unique
drop index if exists public.idx_contract_signers_token;             -- = contract_signers_token_key
drop index if exists public.idx_contract_versions_contract;         -- = contract_versions_contract_id_version_no_key
drop index if exists public.idx_customer_portal_tokens_token;       -- = customer_portal_tokens_token_key
drop index if exists public.idx_owner_portal_tokens_token;          -- = owner_portal_tokens_token_key
drop index if exists public.idx_recurring_occ_rule;                 -- = recurring_occurrences_period_unique
drop index if exists public.idx_rent_charges_rental;                -- = rent_charges_rental_id_period_key
drop index if exists public.idx_share_links_token;                  -- = share_links_token_key
drop index if exists public.idx_tcmb_rates_date_desc;               -- = tcmb_rates_pkey (rate_date)
drop index if exists public.idx_user_scopes_tenant_user;            -- = user_scopes_tenant_id_user_id_key

-- B) tenant_id'si hic indeksli olmayan 12 tablo
create index if not exists idx_direct_file_uploads_tenant               on public.direct_file_uploads (tenant_id);
create index if not exists idx_finance_statement_mappings_tenant        on public.finance_statement_mappings (tenant_id);
create index if not exists idx_lead_capture_token_revocations_tenant    on public.lead_capture_token_revocations (tenant_id);
create index if not exists idx_platform_announcements_tenant            on public.platform_announcements (tenant_id);
create index if not exists idx_public_mutation_outbox_tenant            on public.public_mutation_outbox (tenant_id);
create index if not exists idx_saved_views_tenant                       on public.saved_views (tenant_id);
create index if not exists idx_settings_history_tenant                  on public.settings_history (tenant_id);
create index if not exists idx_storage_deletion_outbox_tenant           on public.storage_deletion_outbox (tenant_id);
create index if not exists idx_success_stories_tenant                   on public.success_stories (tenant_id);
create index if not exists idx_support_ticket_attachment_uploads_tenant on public.support_ticket_attachment_uploads (tenant_id);
create index if not exists idx_survey_attempts_tenant                   on public.survey_attempts (tenant_id);
create index if not exists idx_survey_questions_tenant                  on public.survey_questions (tenant_id);
