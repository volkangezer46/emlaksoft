-- Rollback: 20260826002060_lc_anomaly_rpcs. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz fonksiyonlar silinir; tablolardaki veri korunur.
drop function if exists public.lc_resolve_anomaly(uuid, text, text);
drop function if exists public.lc_explain_anomaly(uuid, text, text);
drop function if exists public.lc_acknowledge_anomaly(uuid);
drop function if exists public.lc_decide_matching_candidate(uuid, uuid, text, uuid, uuid);
drop function if exists public.lc_register_matching_candidates(uuid, jsonb);
drop function if exists public.lc_escalate_anomaly(uuid, uuid, smallint, text, uuid, text);
drop function if exists public.lc_sync_anomalies(uuid, uuid, jsonb, text[]);
