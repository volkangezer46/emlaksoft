-- customer_files RLS düzeltmesi (rls-audit bulgusu):
-- eski politika auth.jwt()->>'tenant_id' kullanıyordu; app_metadata yedeği yok.
-- Projedeki standart: public.current_tenant_id() (JWT claim + app_metadata fallback).
drop policy if exists customer_files_tenant on public.customer_files;

create policy customer_files_tenant on public.customer_files for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
