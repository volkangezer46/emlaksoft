-- Sözleşme türü enum'una iki gerçek tür: yer_gosterme + kapora
--
-- Bugüne kadar "Yer Gösterme Tutanağı" ve "Kapora Sözleşmesi" en yakın türlere
-- (diger/satis) sıkıştırılıyordu; artık kendi enum değerleri var.
--
-- TRANSACTION KISITI (bilinçli iki dosya):
--  * Postgres'te ALTER TYPE ... ADD VALUE ile eklenen yeni enum değeri AYNI
--    transaction içinde KULLANILAMAZ ("unsafe use of new value" hatası).
--  * apply-one.ts dosyayı tek client.query() çağrısıyla koşar — çok statement'lı
--    simple query tek örtük transaction'dır. Bu yüzden yeni değerleri kullanan
--    UPDATE/INSERT'ler bu dosyada DEĞİL, 20260726000087b_contract_types_usage.sql
--    dosyasındadır. Sıra: önce bu dosya, sonra 87b (her ikisi apply-one.ts ile).
--  * Her ADD VALUE ayrı statement; IF NOT EXISTS ile tekrar koşulabilir.

alter type public.contract_type add value if not exists 'yer_gosterme';

alter type public.contract_type add value if not exists 'kapora';

-- Yeni değerleri KULLANAN adımlar için: supabase/migrations/20260726000087b_contract_types_usage.sql
