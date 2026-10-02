-- Tenant-safe WhatsApp Cloud API provisioning metadata and atomic audit.
-- Access tokens remain exclusively in tenant_integration_secrets.

alter table public.tenant_integrations
  add column if not exists whatsapp_business_account_id text,
  add column if not exists graph_api_version text;

alter table public.tenant_integrations
  drop constraint if exists tenant_integrations_whatsapp_cloud_contract;
alter table public.tenant_integrations
  add constraint tenant_integrations_whatsapp_cloud_contract
  check (
    provider <> 'whatsapp'
    or not is_active
    or (
      external_account_id is not null
      and external_account_id ~ '^[0-9]{5,32}$'
      and whatsapp_business_account_id is not null
      and whatsapp_business_account_id ~ '^[0-9]{5,32}$'
      and graph_api_version in ('v22.0', 'v23.0', 'v24.0', 'v25.0')
    )
  ) not valid;

grant select (
  whatsapp_business_account_id,
  graph_api_version
) on table public.tenant_integrations to authenticated;

comment on column public.tenant_integrations.whatsapp_business_account_id is
  'Non-secret Meta WhatsApp Business Account ID used for approved template discovery.';
comment on column public.tenant_integrations.graph_api_version is
  'Allowlisted Meta Graph API version used by this tenant integration.';

create or replace function public.upsert_tenant_whatsapp_cloud_integration(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_phone_number_id text,
  p_whatsapp_business_account_id text,
  p_graph_api_version text,
  p_access_token text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration_id uuid;
  v_existing_access_token text;
  v_access_token text := nullif(btrim(coalesce(p_access_token, '')), '');
  v_phone_number_id text := btrim(coalesce(p_phone_number_id, ''));
  v_waba_id text := btrim(coalesce(p_whatsapp_business_account_id, ''));
  v_graph_version text := btrim(coalesce(p_graph_api_version, ''));
  v_old_phone_number_id text;
  v_old_waba_id text;
  v_old_graph_version text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status in ('trial', 'active', 'past_due')
  ) then
    raise exception 'Tenant is not eligible for WhatsApp provisioning.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_id
      and p.tenant_id = p_tenant_id
      and p.is_active = true
  ) then
    raise exception 'Active tenant actor is required.' using errcode = '42501';
  end if;
  if v_phone_number_id !~ '^[0-9]{5,32}$'
     or v_waba_id !~ '^[0-9]{5,32}$'
     or v_graph_version not in ('v22.0', 'v23.0', 'v24.0', 'v25.0') then
    raise exception 'Invalid WhatsApp Cloud API metadata.' using errcode = '22023';
  end if;

  select
    ti.id,
    ti.external_account_id,
    ti.whatsapp_business_account_id,
    ti.graph_api_version,
    coalesce(
      nullif(btrim(tis.credentials ->> 'access_token'), ''),
      nullif(btrim(tis.credentials ->> 'accessToken'), ''),
      nullif(btrim(tis.credentials ->> 'api_token'), ''),
      nullif(btrim(tis.credentials ->> 'apiToken'), ''),
      nullif(btrim(tis.credentials ->> 'token'), '')
    )
    into
      v_integration_id,
      v_old_phone_number_id,
      v_old_waba_id,
      v_old_graph_version,
      v_existing_access_token
  from public.tenant_integrations ti
  left join public.tenant_integration_secrets tis
    on tis.integration_id = ti.id
  where ti.tenant_id = p_tenant_id
    and ti.provider = 'whatsapp'
  for update of ti;

  v_access_token := coalesce(v_access_token, v_existing_access_token);
  if v_access_token is null
     or char_length(v_access_token) < 20
     or char_length(v_access_token) > 4096
     or v_access_token ~ '[[:space:][:cntrl:]]' then
    raise exception 'A valid WhatsApp access token is required.' using errcode = '22023';
  end if;

  insert into public.tenant_integrations (
    tenant_id,
    provider,
    credentials,
    external_account_id,
    whatsapp_business_account_id,
    graph_api_version,
    connection_status,
    last_checked_at,
    last_error,
    is_active,
    updated_by,
    updated_at
  ) values (
    p_tenant_id,
    'whatsapp',
    public.mask_tenant_integration_credentials(
      'whatsapp',
      jsonb_build_object('access_token', v_access_token)
    ),
    v_phone_number_id,
    v_waba_id,
    v_graph_version,
    'configured',
    null,
    null,
    true,
    p_actor_id,
    now()
  )
  on conflict (tenant_id, provider) do update
  set
    credentials = excluded.credentials,
    external_account_id = excluded.external_account_id,
    whatsapp_business_account_id = excluded.whatsapp_business_account_id,
    graph_api_version = excluded.graph_api_version,
    connection_status = 'configured',
    last_checked_at = null,
    last_error = null,
    is_active = true,
    updated_by = p_actor_id,
    updated_at = now()
  returning id into v_integration_id;

  insert into public.tenant_integration_secrets (
    integration_id,
    credentials,
    updated_at
  ) values (
    v_integration_id,
    jsonb_build_object('access_token', v_access_token),
    now()
  )
  on conflict (integration_id) do update
  set
    credentials = excluded.credentials,
    updated_at = now();

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  ) values (
    p_tenant_id,
    p_actor_id,
    'tenant_integration.whatsapp.upsert',
    'tenant_integration',
    v_integration_id,
    jsonb_build_object(
      'provider', 'whatsapp',
      'phone_number_id', v_old_phone_number_id,
      'waba_id', v_old_waba_id,
      'graph_api_version', v_old_graph_version,
      'configured', v_existing_access_token is not null
    ),
    jsonb_build_object(
      'provider', 'whatsapp',
      'phone_number_id', v_phone_number_id,
      'waba_id', v_waba_id,
      'graph_api_version', v_graph_version,
      'configured', true
    )
  );

  return v_integration_id;
end;
$$;

create or replace function public.delete_tenant_whatsapp_cloud_integration(
  p_tenant_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration_id uuid;
  v_phone_number_id text;
  v_waba_id text;
  v_graph_version text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_id
      and p.tenant_id = p_tenant_id
      and p.is_active = true
  ) then
    raise exception 'Active tenant actor is required.' using errcode = '42501';
  end if;

  select
    ti.id,
    ti.external_account_id,
    ti.whatsapp_business_account_id,
    ti.graph_api_version
    into
      v_integration_id,
      v_phone_number_id,
      v_waba_id,
      v_graph_version
  from public.tenant_integrations ti
  where ti.tenant_id = p_tenant_id
    and ti.provider = 'whatsapp'
  for update;

  if not found then
    return null;
  end if;

  delete from public.tenant_integrations ti
  where ti.id = v_integration_id
    and ti.tenant_id = p_tenant_id
    and ti.provider = 'whatsapp';

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  ) values (
    p_tenant_id,
    p_actor_id,
    'tenant_integration.whatsapp.delete',
    'tenant_integration',
    v_integration_id,
    jsonb_build_object(
      'provider', 'whatsapp',
      'phone_number_id', v_phone_number_id,
      'waba_id', v_waba_id,
      'graph_api_version', v_graph_version,
      'configured', true
    ),
    jsonb_build_object('provider', 'whatsapp', 'configured', false)
  );

  return v_integration_id;
end;
$$;

revoke all on function public.upsert_tenant_whatsapp_cloud_integration(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_tenant_whatsapp_cloud_integration(
  uuid, uuid, text, text, text, text
) to service_role;

revoke all on function public.delete_tenant_whatsapp_cloud_integration(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_tenant_whatsapp_cloud_integration(uuid, uuid)
  to service_role;

comment on function public.upsert_tenant_whatsapp_cloud_integration(
  uuid, uuid, text, text, text, text
) is 'Atomic tenant WhatsApp Cloud metadata/secret upsert with secret-free audit.';
comment on function public.delete_tenant_whatsapp_cloud_integration(uuid, uuid) is
  'Atomic tenant WhatsApp Cloud delete with cascading secret removal and secret-free audit.';

notify pgrst, 'reload schema';
