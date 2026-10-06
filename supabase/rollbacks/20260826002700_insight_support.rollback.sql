-- Rollback: 20260826002700_insight_support. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz fonksiyon/gorunum duser; veri kaybi yok. Cron bu RPC'ler yoksa kural olgusu toplayamaz ve kalan isi
-- "etkin degil" diye raporlayip cikar (hata degil).
drop view if exists public.insight_rule_quality;
drop function if exists public.insight_housekeeping(int, int);
drop function if exists public.insight_deadlines(uuid, int, int);
drop function if exists public.insight_stale_listings(uuid, int, int);
drop function if exists public.insight_weekly_series(uuid, text, int);
drop function if exists public.insight_stalled_deals(uuid, int, int);
drop function if exists public.insight_quiet_valuable_customers(uuid, int, int);
notify pgrst, 'reload schema';
