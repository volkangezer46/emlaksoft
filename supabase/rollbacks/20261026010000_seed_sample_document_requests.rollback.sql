-- 20261026010000 geri alma: ornek evrak talebi tohum fonksiyonu duser (tohum "evrak talepleri" grubunu "migration
-- uygulanmamis" diye atlar; mevcut evrak talebi satirlarina ve tablo yetkilerine dokunulmaz).
drop function if exists public.seed_sample_document_requests(uuid, jsonb);
