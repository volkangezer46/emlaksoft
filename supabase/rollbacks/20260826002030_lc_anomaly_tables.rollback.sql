-- Rollback: 20260826002030_lc_anomaly_tables. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- UYARI: anomali kayitlari, aciklamalar, SLA olaylari ve eslestirme adaylari KAYBOLUR. Once 002040..002070 geri alinmali.
drop table if exists public.listing_matching_candidates;
drop table if exists public.listing_sla_events;
drop table if exists public.listing_anomaly_actions;
drop table if exists public.listing_anomalies;
