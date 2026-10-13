-- 20261013002020 geri alma: ogrenme/otomatik yayin/saklama fonksiyonlari dusurulur (ters sira).
-- Tablolar ve veri 20261013002000 geri alinana kadar kalir. Kodda cron adimlari fonksiyon yokken 'skipped' doner.
set local lock_timeout = '5s';

drop function if exists public.pt_learning_retention(timestamptz);
drop function if exists public.pt_rules_mark_invalid(uuid[], text);
drop function if exists public.pt_rules_publish_system(text, jsonb, text, uuid, jsonb, text, text, text, uuid[]);
drop function if exists public.pt_rules_learn(timestamptz);
drop function if exists public.pt_rules_learn_evidence(timestamptz, uuid[]);
drop function if exists public.pt_rules_risky_keys();
drop function if exists public.pt_rules_eligible_tenants(timestamptz);
drop function if exists public.pt_wilson_lb(integer, integer);
drop function if exists public.pt_rules_setting_bool(text, boolean);
drop function if exists public.pt_rules_setting_int(text, integer, integer, integer);

notify pgrst, 'reload schema';
