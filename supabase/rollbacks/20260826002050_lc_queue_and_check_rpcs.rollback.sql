-- Rollback: 20260826002050_lc_queue_and_check_rpcs. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz fonksiyonlar silinir; tablolardaki veri korunur.
drop function if exists public.lc_submit_manual_check(uuid, text, jsonb);
drop function if exists public.lc_complete_listing_check(uuid, uuid, text, text, uuid, uuid, jsonb, text, jsonb, timestamptz);
drop function if exists public.lc_apply_check(uuid, uuid, text, text, uuid, uuid, jsonb, text, jsonb, timestamptz);
drop function if exists public.lc_reap_verification_jobs();
drop function if exists public.lc_claim_verification_jobs(uuid, uuid, integer, integer, integer);
drop function if exists public.lc_enqueue_verification_jobs(uuid, jsonb);
