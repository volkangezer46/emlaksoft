-- Rollback: 20260826002600_platform_insights. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- ONCE: 20260826002700_insight_support geri alinmis olmali (temizlik fonksiyonu bu tabloya basvurur).
-- Veri kaybi: platform icgoru satirlari (turetilebilir veri).
drop function if exists public.platform_insight_set_state(uuid, text, text, timestamptz);
drop table if exists public.platform_insights;
notify pgrst, 'reload schema';
