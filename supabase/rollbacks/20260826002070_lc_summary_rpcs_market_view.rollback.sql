-- Rollback: 20260826002070_lc_summary_rpcs_market_view. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: property_status_history.reason_code / exit_kind kolonlarindaki degerler KAYBOLUR.
drop view if exists public.control_market_signals_v;
drop function if exists public.lc_sweep_candidates(integer, integer);
drop function if exists public.lc_upsert_control_states(uuid, jsonb);
drop function if exists public.listing_control_changes_since(timestamptz);
drop function if exists public.listing_control_list(text, text, uuid, integer, smallint, uuid, boolean);
drop function if exists public.listing_control_summary(text, boolean);
alter table if exists public.property_status_history drop constraint if exists property_status_history_reason_code_check;
alter table if exists public.property_status_history drop constraint if exists property_status_history_exit_kind_check;
alter table if exists public.property_status_history drop column if exists exit_kind;
alter table if exists public.property_status_history drop column if exists reason_code;
