-- Rollback: 20260823000400_sec3_property_owner_info_update_scope
-- UYARI: güvenlik açığı #11 yeniden açılır (UPDATE WITH CHECK yalnız tenant).

drop trigger if exists trg_property_owner_info_guard on public.property_owner_info;
drop function if exists public.guard_property_owner_info_update();

drop policy if exists property_owner_info_update on public.property_owner_info;
create policy property_owner_info_update on public.property_owner_info for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('properties', 'edit'))
  and (
    (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
    or exists (
      select 1 from public.properties p
      where p.id = property_owner_info.property_id and p.tenant_id = property_owner_info.tenant_id
        and (p.assigned_to = (select auth.uid()) or p.created_by = (select auth.uid()))
    )
  )
)
with check (tenant_id = (select public.current_tenant_id()));

notify pgrst, 'reload schema';
