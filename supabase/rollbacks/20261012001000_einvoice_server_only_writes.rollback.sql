-- 20261012001000 geri alma: *_srv RPC'leri duser, eski RPC'ler authenticated'a geri acilir.
drop function if exists public.einvoice_srv_record_progress(uuid, uuid, uuid, jsonb, text, text, boolean);
drop function if exists public.einvoice_srv_mark_issued(uuid, uuid, uuid, jsonb, text);
drop function if exists public.einvoice_srv_record_status(uuid, uuid, uuid, text, text, text, text, jsonb);
drop function if exists public.einvoice_srv_mark_cancelled(uuid, uuid, uuid, text);
drop function if exists public.einvoice_srv_recover_issue(uuid, uuid, text, jsonb, text);
grant execute on function public.einvoice_record_progress(uuid, jsonb, text, text, boolean) to authenticated;
grant execute on function public.einvoice_mark_issued(uuid, jsonb, text) to authenticated;
grant execute on function public.einvoice_record_status(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.einvoice_mark_cancelled(uuid, text) to authenticated;
grant execute on function public.einvoice_recover_issue_mine(uuid, text, jsonb, text) to authenticated;
