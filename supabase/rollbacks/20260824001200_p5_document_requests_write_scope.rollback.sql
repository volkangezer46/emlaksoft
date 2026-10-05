-- Rollback: 20260824001200_p5_document_requests_write_scope
-- UYARI: açık yeniden açılır (her ofis üyesi başkasının evrak linkini yeniden açabilir, süresini/kotasını/token
-- özetini/bağlı kaydını değiştirebilir; created_by sahte yazılabilir).
-- 20260821000300'deki tenant-only politikalar birebir geri kurulur.

drop trigger if exists trg_document_requests_guard on public.document_requests;
drop function if exists public.guard_document_request_update();

drop policy if exists document_requests_tenant_insert on public.document_requests;
create policy document_requests_tenant_insert on public.document_requests
  for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists document_requests_tenant_update on public.document_requests;
create policy document_requests_tenant_update on public.document_requests
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

notify pgrst, 'reload schema';
