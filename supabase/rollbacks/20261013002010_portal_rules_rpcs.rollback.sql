-- 20261013002010 geri alma: JWT RPC'leri ve ic yardimcilar dusurulur (ters sira; once 20261013002020 geri alinmali,
-- o dosya pt_rules_insert_set ve pt_rules_audit'e dayanir). Kod RPC yokken kural ucunda sets:[] / schema_pending doner.
set local lock_timeout = '5s';

drop function if exists public.pt_rules_admin_record_ai(text, text, jsonb);
drop function if exists public.pt_rules_admin_trust_list();
drop function if exists public.pt_rules_admin_set_trust(uuid, boolean, text);
drop function if exists public.pt_rules_admin_rollback(text, integer, jsonb, text, text, text);
drop function if exists public.pt_rules_admin_publish(text, jsonb, text, uuid, jsonb, text, text, text, uuid[]);
drop function if exists public.pt_rules_admin_propose(text, text, text, jsonb, text);
drop function if exists public.pt_rules_admin_decide(uuid, text, text, boolean);
drop function if exists public.pt_rules_admin_evidence(uuid);
drop function if exists public.pt_rules_admin_overview(text);
drop function if exists public.pt_report_form_feedback(uuid, jsonb);
drop function if exists public.pt_rules_current(text);
drop function if exists public.pt_rules_insert_set(text, jsonb, text, uuid, jsonb, text, text, text, uuid, uuid, uuid[]);
drop function if exists public.pt_rules_audit(uuid, text, text, uuid, jsonb);
drop function if exists public.pt_feedback_label_personal(text);
drop function if exists public.pt_feedback_text_ok(text);

notify pgrst, 'reload schema';
