-- 20261012000100 geri alma: kurtarma fonksiyonlari ve isaret sutunu duser.
-- ON KOSUL: issue_stage dolu (belirsiz) satir kalmamali; once cozun. Sonra 20261011000600_einvoice_state_machine.sql
-- icindeki create or replace blogu (save_draft, claim_issue, record_progress, mark_issued, reopen, delete_draft)
-- yeniden calistirilarak eski govdeler (issue_stage'e bakmayan) geri yuklenir.
drop function if exists public.einvoice_recover_issue(uuid, text, jsonb, text);
drop function if exists public.einvoice_recover_issue_mine(uuid, text, jsonb, text);
drop function if exists public._einvoice_recover_apply(uuid, uuid, text, jsonb, text);
drop function if exists public.einvoice_mark_issue_sent(uuid);
drop index if exists public.einvoices_issue_stage_idx;
alter table public.einvoices drop constraint if exists einvoices_issue_stage_check;
alter table public.einvoices drop column if exists issue_stage;
grant execute on function public.einvoice_save_draft(uuid, jsonb) to service_role;
grant execute on function public.einvoice_claim_issue(uuid) to service_role;
grant execute on function public.einvoice_record_progress(uuid, jsonb, text, text, boolean) to service_role;
grant execute on function public.einvoice_mark_issued(uuid, jsonb, text) to service_role;
grant execute on function public.einvoice_record_status(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.einvoice_mark_cancelled(uuid, text) to service_role;
grant execute on function public.einvoice_reopen(uuid) to service_role;
grant execute on function public.einvoice_delete_draft(uuid) to service_role;
