-- GERI ALMA: 20261024010000_zeka_learning — Zeka ogrenme katmani (gunluk, onayli soru-cevap, gomme dizini) duser.
-- Kod tablo/RPC yokken calismayi surdurur (yerel zeka + kod bilgisi); gunluk ve soru-cevaplar KALICI olarak silinir.

set local lock_timeout = '5s';

drop function if exists public.zeka_usage_stats(integer);
drop function if exists public.zeka_knowledge_vectors_state();
drop function if exists public.zeka_knowledge_vectors_store(jsonb, text[]);
drop function if exists public.zeka_knowledge_vectors_read();
drop table if exists public.zeka_knowledge_vectors;
drop table if exists public.zeka_qa;
drop function if exists public.zeka_query_feedback(uuid, integer);
drop function if exists public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid);
drop table if exists public.zeka_query_log;
