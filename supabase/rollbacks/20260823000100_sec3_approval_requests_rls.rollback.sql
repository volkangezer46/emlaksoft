-- Rollback: 20260823000100_sec3_approval_requests_rls
-- UYARI: eski geniş `for all` tenant politikası geri gelir (güvenlik açığı #1 yeniden açılır).
-- UYARI: consumed_at sütunu düşer; kod bu sütunu kullanmaya başladıysa önce kodu geri alın.

drop trigger if exists trg_approval_requests_guard on public.approval_requests;
drop function if exists public.guard_approval_request_update();

drop policy if exists approval_requests_select on public.approval_requests;
drop policy if exists approval_requests_insert on public.approval_requests;
drop policy if exists approval_requests_update on public.approval_requests;
drop policy if exists approval_requests_tenant on public.approval_requests;

create policy approval_requests_tenant on public.approval_requests
  for all
  using ((tenant_id = (select public.current_tenant_id())))
  with check ((tenant_id = (select public.current_tenant_id())));

drop function if exists public.approval_actor_can_decide();

drop index if exists public.idx_approval_requests_unconsumed;
alter table public.approval_requests drop column if exists consumed_at;

notify pgrst, 'reload schema';
