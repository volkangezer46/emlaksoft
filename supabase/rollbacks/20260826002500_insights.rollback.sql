-- Rollback: 20260826002500_insights. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- ONCE: 20260826002700_insight_support (insight_rule_quality gorunumu bu tabloya baglidir) geri alinmis olmali.
-- Kod tablo/RPC yoksa bos dizi ve "etkin degil" davranisina duser (okuyucu firlatmaz); cron islem yapmadan cikar.
-- Veri kaybi: tum icgoru satirlari (turetilebilir veri; kural motoru bir sonraki turda yeniden uretir).
drop function if exists public.insight_set_state(uuid, text, text, timestamptz, uuid);
drop table if exists public.insights;
notify pgrst, 'reload schema';
