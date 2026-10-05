-- Rollback: 20260824001100_p5_neighborhood_notes_owner_scope
-- UYARI: açık yeniden açılır (her ofis üyesi başkasının notunu değiştirip silebilir, created_by sahte yazılabilir).
-- 20260821000100'deki tenant-only politikalar birebir geri kurulur.

drop trigger if exists trg_neighborhood_notes_guard on public.neighborhood_notes;
drop function if exists public.guard_neighborhood_note_update();

drop policy if exists neighborhood_notes_tenant_insert on public.neighborhood_notes;
create policy neighborhood_notes_tenant_insert on public.neighborhood_notes
  for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists neighborhood_notes_tenant_update on public.neighborhood_notes;
create policy neighborhood_notes_tenant_update on public.neighborhood_notes
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists neighborhood_notes_tenant_delete on public.neighborhood_notes;
create policy neighborhood_notes_tenant_delete on public.neighborhood_notes
  for delete using (tenant_id = public.current_tenant_id());

notify pgrst, 'reload schema';
