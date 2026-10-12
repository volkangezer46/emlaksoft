-- 20261012002800 geri alma: SELECT politikalari kiraci geneline, assigned_to/deleted_at UPDATE yetkisi geri, RPC'ler kalkar.
do $$
begin
  if pg_catalog.to_regclass('public.fsbo_leads') is null then return; end if;
  drop policy if exists fsbo_leads_select on public.fsbo_leads;
  create policy fsbo_leads_select on public.fsbo_leads
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'view'));
  drop policy if exists fsbo_observations_select on public.fsbo_lead_observations;
  create policy fsbo_observations_select on public.fsbo_lead_observations
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'view'));
  drop policy if exists fsbo_activities_select on public.fsbo_lead_activities;
  create policy fsbo_activities_select on public.fsbo_lead_activities
    for select to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'view'));
  grant update (assigned_to, deleted_at) on public.fsbo_leads to authenticated;
end
$$;

drop function if exists public.fsbo_find_existing(text, text, text);
drop function if exists public.fsbo_assign_lead(uuid, uuid);
drop function if exists public.fsbo_archive_lead(uuid);
drop function if exists public.fsbo_office_wide_role();
drop function if exists public.fsbo_manage_role();
notify pgrst, 'reload schema';
