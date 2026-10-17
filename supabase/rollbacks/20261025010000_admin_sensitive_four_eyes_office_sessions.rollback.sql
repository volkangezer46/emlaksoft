-- ROLLBACK 20261025010000_admin_sensitive_four_eyes_office_sessions.sql
-- Ofis oturumlari fonksiyonlari ve dort goz izin tuketimi duser; hassas turdeki talepler SILINIR (kind CHECK'i eski
-- dort ture doner). Ledger'a dokunmaz. Veri kaybi: yalniz hassas islem onay talepleri (denetim izi platform_activity'de kalir).

set local lock_timeout = '5s';

drop function if exists public.platform_revoke_office_user_sessions(uuid);
drop function if exists public.platform_revoke_office_session(uuid);
drop function if exists public.platform_office_session_operator();
drop function if exists public.platform_list_office_sessions(uuid, uuid, integer);
drop function if exists public.platform_mask_ip(inet);
drop function if exists public.platform_consume_approval(text, text, text, uuid, jsonb);
drop index if exists public.platform_approval_grant_idx;

delete from public.platform_approval_requests
 where kind in ('session_revoke', 'flag_change', 'queue_requeue', 'demo_data', 'impersonation');

alter table public.platform_approval_requests drop constraint if exists platform_approval_requests_kind_check;
alter table public.platform_approval_requests add constraint platform_approval_requests_kind_check
  check (kind in ('refund', 'credit_grant', 'office_close', 'staff_role'));
alter table public.platform_approval_requests drop constraint if exists platform_approval_requests_module_check;
alter table public.platform_approval_requests add constraint platform_approval_requests_module_check
  check (module in ('billing', 'tenants', 'personel'));
