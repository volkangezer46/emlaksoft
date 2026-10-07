-- Rollback: 20261007000600_webhook_enqueue_gate
-- webhook_enqueue / webhook_mark_delivery 20261007000320 govdelerine BIREBIR doner (izin kapisi ve ilk-deneme kisiti kalkar),
-- enqueued_by sutunu dusurulur (yalniz kuyruk meta verisi; kaybolan bilgi: satiri hangi kullanicinin yazdigi).

set local lock_timeout = '5s';

-- ------------------------------------------------------------------ webhook_enqueue
create or replace function public.webhook_enqueue(p_event text, p_entity_type text, p_entity_id uuid)
returns table (delivery_id uuid, endpoint_id uuid, url text, secret_version integer, payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid := public.current_tenant_id();
  v_pending integer;
  v_data jsonb;
  v_body jsonb;
begin
  if auth.uid() is null or v_tenant is null then
    return;
  end if;
  if p_event not in ('customer.created', 'customer.updated', 'property.created', 'property.updated', 'deal.created', 'deal.updated') then
    raise exception 'gecersiz olay' using errcode = '22023';
  end if;
  if p_entity_type not in ('customer', 'property', 'deal') then
    raise exception 'gecersiz varlik' using errcode = '22023';
  end if;
  if not exists (select 1 from public.webhook_endpoints e where e.tenant_id = v_tenant and e.active and p_event = any (e.events)) then
    return;
  end if;
  select count(*) into v_pending from public.webhook_deliveries d where d.tenant_id = v_tenant and d.status = 'pending';
  if v_pending >= 1000 then
    return;
  end if;
  -- Veri TEK KAYNAKTAN (api_v1_list ile ayni alanlar), ofis + ornek veri suzgeciyle; ornek kayit olay URETMEZ.
  if p_entity_type = 'customer' then
    select to_jsonb(r) into v_data from (
      select c.id, c.full_name, c.phone, c.email, c.source, c.customer_types, c.created_at
        from public.customers c where c.id = p_entity_id and c.tenant_id = v_tenant and c.is_sample = false
    ) r;
  elsif p_entity_type = 'property' then
    select to_jsonb(r) into v_data from (
      select p.id, p.property_code, p.title, p.status, p.transaction_type, p.property_type, p.list_price,
             p.features->>'rooms' as rooms, p.features->>'sqm' as sqm, p.province_id, p.district_id, p.created_at, p.updated_at
        from public.properties p where p.id = p_entity_id and p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null
    ) r;
  else
    select to_jsonb(r) into v_data from (
      select d.id, d.deal_type, d.stage, d.deal_value, d.property_id, d.customer_id, d.created_at, d.updated_at
        from public.deals d where d.id = p_entity_id and d.tenant_id = v_tenant and d.is_sample = false
    ) r;
  end if;
  if v_data is null then
    return;
  end if;
  v_body := jsonb_build_object(
    'event', p_event,
    'occurred_at', now(),
    'tenant_id', v_tenant,
    'entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id),
    'data', v_data
  );
  return query
    insert into public.webhook_deliveries as d (tenant_id, endpoint_id, event, payload)
    select v_tenant, e.id, p_event, v_body
    from public.webhook_endpoints e
    where e.tenant_id = v_tenant and e.active and p_event = any (e.events)
    returning d.id, d.endpoint_id,
      (select e2.url from public.webhook_endpoints e2 where e2.id = d.endpoint_id),
      (select e2.secret_version from public.webhook_endpoints e2 where e2.id = d.endpoint_id),
      d.payload;
end;
$$;

-- ------------------------------------------------------------------ webhook_mark_delivery
create or replace function public.webhook_mark_delivery(p_id uuid, p_ok boolean, p_status integer, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_endpoint uuid;
  v_attempts integer;
begin
  if auth.uid() is null or v_tenant is null then
    return;
  end if;
  update public.webhook_deliveries d
     set attempts = d.attempts + 1,
         status = case when p_ok then 'delivered' when d.attempts + 1 >= 6 then 'failed' else 'pending' end,
         delivered_at = case when p_ok then now() else null end,
         next_attempt_at = now() + make_interval(mins => least(720, (power(2, d.attempts + 1) * 5)::int)),
         last_status_code = p_status,
         last_error = case when p_ok then null else left(coalesce(p_error, ''), 300) end
   where d.id = p_id and d.tenant_id = v_tenant and d.status = 'pending'
   returning d.endpoint_id, d.attempts into v_endpoint, v_attempts;
  if v_endpoint is not null then
    update public.webhook_endpoints e
       set last_status = p_status,
           last_delivery_at = now(),
           failure_count = case when p_ok then 0 else e.failure_count + 1 end
     where e.id = v_endpoint and e.tenant_id = v_tenant;
  end if;
end;
$$;

revoke all on function public.webhook_enqueue(text, text, uuid) from public, anon;
revoke all on function public.webhook_mark_delivery(uuid, boolean, integer, text) from public, anon;
grant execute on function public.webhook_enqueue(text, text, uuid) to authenticated, service_role;
grant execute on function public.webhook_mark_delivery(uuid, boolean, integer, text) to authenticated, service_role;

alter table public.webhook_deliveries drop column if exists enqueued_by;

notify pgrst, 'reload schema';
