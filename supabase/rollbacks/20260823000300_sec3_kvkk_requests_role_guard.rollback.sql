-- Rollback: 20260823000300_sec3_kvkk_requests_role_guard
-- UYARI: güvenlik açığı #8 yeniden açılır (her üye ofis düzeyi talep açıp durumunu değiştirebilir).

drop trigger if exists trg_kvkk_requests_guard on public.kvkk_requests;
drop function if exists public.guard_kvkk_request_update();

drop policy if exists kvkk_requests_tenant_insert on public.kvkk_requests;
create policy kvkk_requests_tenant_insert on public.kvkk_requests
  for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists kvkk_requests_tenant_update on public.kvkk_requests;
create policy kvkk_requests_tenant_update on public.kvkk_requests
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

notify pgrst, 'reload schema';
