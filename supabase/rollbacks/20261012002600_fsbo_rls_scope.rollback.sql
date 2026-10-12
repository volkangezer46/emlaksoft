-- 20261012002600 geri alma: FSBO politikalari 002400 haline, tablo UPDATE yetkisi geri, RPC'ler izin kapisiz hale doner.
do $$
begin
  if pg_catalog.to_regclass('public.fsbo_leads') is null then return; end if;
  drop policy if exists fsbo_leads_update on public.fsbo_leads;
  create policy fsbo_leads_update on public.fsbo_leads
    for update to authenticated
    using (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'edit'))
    with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'edit'));
  drop policy if exists fsbo_leads_insert on public.fsbo_leads;
  create policy fsbo_leads_insert on public.fsbo_leads
    for insert to authenticated
    with check (tenant_id = public.current_tenant_id() and public.has_effective_permission('prospecting', 'create'));
  grant update on public.fsbo_leads to authenticated;
end
$$;

create or replace function public.insight_close_fsbo_lead(p_lead_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := public.current_tenant_id(); v_uid uuid := auth.uid(); v_rows integer := 0;
begin
  if v_uid is null or v_tenant is null or p_lead_id is null then return 0; end if;
  if pg_catalog.to_regclass('public.fsbo_leads') is null then return 0; end if;
  if not exists (select 1 from public.fsbo_leads l where l.id = p_lead_id and l.tenant_id = v_tenant) then return 0; end if;
  update public.insights i set valid_until = pg_catalog.now()
   where i.tenant_id = v_tenant and i.kind = 'call_priority' and i.entity_type = 'fsbo_lead' and i.entity_id = p_lead_id
     and i.state in ('new', 'seen', 'snoozed') and i.valid_until > pg_catalog.now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.insight_close_call_priority(p_customer_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := public.current_tenant_id(); v_uid uuid := auth.uid(); v_rows integer := 0;
begin
  if v_uid is null or v_tenant is null or p_customer_id is null then return 0; end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant) then return 0; end if;
  update public.insights i set valid_until = pg_catalog.now()
   where i.tenant_id = v_tenant and i.kind = 'call_priority' and i.entity_type = 'customer' and i.entity_id = p_customer_id
     and i.state in ('new', 'seen', 'snoozed') and i.valid_until > pg_catalog.now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.insight_close_fsbo_lead(uuid) from public, anon;
grant execute on function public.insight_close_fsbo_lead(uuid) to authenticated;
revoke all on function public.insight_close_call_priority(uuid) from public, anon;
grant execute on function public.insight_close_call_priority(uuid) to authenticated;
notify pgrst, 'reload schema';
