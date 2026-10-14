-- Geri alma: yalnız FN6 RPC'si kaldırılır. Sütunlar (party_id/vat_rate/withholding_rate) FN1'indir, dokunulmaz;
-- yazılmış koşul değerleri yerinde kalır (veri kaybı yok).
drop function if exists public.recurring_rule_set_terms(uuid, uuid, numeric, numeric);
