-- Forward-only WhatsApp ownership verification and ambiguous-outcome safety.
-- A phone_number_id can route webhooks or send only while its WABA binding is
-- healthy, recently established by the server and fingerprint-consistent.

alter table public.tenant_integrations
  add column if not exists binding_verified_at timestamptz,
  add column if not exists binding_verified_by uuid references auth.users(id) on delete set null,
  add column if not exists binding_fingerprint text,
  add column if not exists binding_verification_evidence jsonb not null default '{}'::jsonb;

grant select (
  binding_verified_at
) on table public.tenant_integrations to authenticated;

comment on column public.tenant_integrations.binding_verified_at is
  'Time at which Meta Graph proved that the configured phone number belongs to the configured WABA.';
comment on column public.tenant_integrations.binding_fingerprint is
  'SHA-256 fingerprint of the immutable active phone_number_id, WABA ID and Graph version binding.';
comment on column public.tenant_integrations.binding_verification_evidence is
  'Secret-free, bounded metadata returned by Meta during ownership verification.';

-- Historical configured-only rows were never verified against Meta. They must
-- not remain eligible for outbound delivery or webhook tenant resolution.
update public.tenant_integrations
set
  is_active = false,
  connection_status = 'disabled',
  binding_verified_at = null,
  binding_verified_by = null,
  binding_fingerprint = null,
  binding_verification_evidence = '{}'::jsonb,
  last_checked_at = now(),
  last_error = 'Meta ownership verification required.',
  updated_at = now()
where provider = 'whatsapp'
  and (
    binding_verified_at is null
    or binding_fingerprint is null
    or connection_status <> 'healthy'
  );

alter table public.tenant_integrations
  drop constraint if exists tenant_integrations_whatsapp_verified_active_contract;
alter table public.tenant_integrations
  add constraint tenant_integrations_whatsapp_verified_active_contract
  check (
    provider <> 'whatsapp'
    or not is_active
    or coalesce((
      connection_status = 'healthy'
      and binding_verified_at is not null
      and binding_fingerprint ~ '^[0-9a-f]{64}$'
      and binding_fingerprint = encode(digest(
        external_account_id || '|' || whatsapp_business_account_id || '|' || graph_api_version,
        'sha256'
      ), 'hex')
      and binding_verification_evidence ->> 'phone_number_id' = external_account_id
      and binding_verification_evidence ->> 'waba_id' = whatsapp_business_account_id
      and binding_verification_evidence ->> 'graph_api_version' = graph_api_version
      and binding_verification_evidence ->> 'code_verification_status' = 'VERIFIED'
    ), false)
  ) not valid;
alter table public.tenant_integrations
  validate constraint tenant_integrations_whatsapp_verified_active_contract;

alter table public.tenant_integrations
  drop constraint if exists tenant_integrations_whatsapp_evidence_contract;
alter table public.tenant_integrations
  add constraint tenant_integrations_whatsapp_evidence_contract
  check (
    jsonb_typeof(binding_verification_evidence) = 'object'
    and pg_column_size(binding_verification_evidence) <= 4096
  ) not valid;
alter table public.tenant_integrations
  validate constraint tenant_integrations_whatsapp_evidence_contract;

-- A partially deployed worker may already have persisted this unsafe pairing.
-- Resolve it fail-closed before validating the permanent database invariant.
update public.campaign_recipients
set
  status = 'failed',
  delivery_state = 'dead_letter',
  dead_lettered_at = coalesce(dead_lettered_at, now()),
  lease_token = null,
  lease_started_at = null,
  error_msg = 'Sağlayıcı sonucu belirsiz; otomatik tekrar engellendi ve manuel mutabakat gerekli.'
where last_error_code = 'unknown_provider_outcome'
  and delivery_state in ('queued', 'retry');

-- Even if a future caller accidentally marks an ambiguous provider outcome as
-- retryable, the database must reject returning that recipient to the queue.
alter table public.campaign_recipients
  drop constraint if exists campaign_recipients_unknown_outcome_not_retry;
alter table public.campaign_recipients
  add constraint campaign_recipients_unknown_outcome_not_retry
  check (
    coalesce(last_error_code, '') <> 'unknown_provider_outcome'
    or delivery_state not in ('queued', 'retry')
  ) not valid;
alter table public.campaign_recipients
  validate constraint campaign_recipients_unknown_outcome_not_retry;

create or replace function public.enforce_verified_whatsapp_binding()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_expected_fingerprint text;
begin
  if tg_op = 'UPDATE' then
    if old.provider = 'whatsapp'
       and old.is_active
       and (
         new.external_account_id is distinct from old.external_account_id
         or new.whatsapp_business_account_id is distinct from old.whatsapp_business_account_id
         or new.graph_api_version is distinct from old.graph_api_version
       ) then
      raise exception 'Verified WhatsApp binding must be deactivated before replacement.'
        using errcode = '42501';
    end if;
  end if;

  if new.provider = 'whatsapp' and new.is_active then
    v_expected_fingerprint := encode(digest(
      new.external_account_id || '|' || new.whatsapp_business_account_id || '|' || new.graph_api_version,
      'sha256'
    ), 'hex');
    if new.connection_status <> 'healthy'
       or new.binding_verified_at is null
       or new.binding_fingerprint is distinct from v_expected_fingerprint
       or new.binding_verification_evidence ->> 'phone_number_id' is distinct from new.external_account_id
       or new.binding_verification_evidence ->> 'waba_id' is distinct from new.whatsapp_business_account_id
       or new.binding_verification_evidence ->> 'graph_api_version' is distinct from new.graph_api_version
       or new.binding_verification_evidence ->> 'code_verification_status' is distinct from 'VERIFIED' then
      raise exception 'Active WhatsApp integration requires a verified immutable binding.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_verified_whatsapp_binding()
  from public, anon, authenticated, service_role;

drop trigger if exists tenant_integrations_verified_whatsapp_binding
  on public.tenant_integrations;
create trigger tenant_integrations_verified_whatsapp_binding
before insert or update on public.tenant_integrations
for each row execute function public.enforce_verified_whatsapp_binding();

-- The configured-only RPC from 00960 must never reactivate a route without a
-- live Meta proof. Existing application callers are moved to the function below.
revoke execute on function public.upsert_tenant_whatsapp_cloud_integration(
  uuid, uuid, text, text, text, text
) from service_role;

create or replace function public.activate_verified_tenant_whatsapp_binding(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_phone_number_id text,
  p_whatsapp_business_account_id text,
  p_graph_api_version text,
  p_access_token text,
  p_verified_phone_number_id text,
  p_verified_waba_id text,
  p_code_verification_status text,
  p_verified_name text,
  p_display_phone_number text,
  p_quality_rating text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration_id uuid;
  v_phone_number_id text := btrim(coalesce(p_phone_number_id, ''));
  v_waba_id text := btrim(coalesce(p_whatsapp_business_account_id, ''));
  v_graph_version text := btrim(coalesce(p_graph_api_version, ''));
  v_access_token text := btrim(coalesce(p_access_token, ''));
  v_verified_name text := btrim(coalesce(p_verified_name, ''));
  v_display_phone_number text := btrim(coalesce(p_display_phone_number, ''));
  v_quality_rating text := upper(btrim(coalesce(p_quality_rating, '')));
  v_fingerprint text;
  v_evidence jsonb;
  v_old_value jsonb := '{}'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status in ('trial', 'active', 'past_due')
  ) or not exists (
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
     or v_graph_version not in ('v22.0', 'v23.0', 'v24.0', 'v25.0')
     or btrim(coalesce(p_verified_phone_number_id, '')) <> v_phone_number_id
     or btrim(coalesce(p_verified_waba_id, '')) <> v_waba_id
     or p_code_verification_status <> 'VERIFIED' then
    raise exception 'Meta ownership proof does not match the requested binding.' using errcode = '22023';
  end if;
  if char_length(v_access_token) < 20
     or char_length(v_access_token) > 4096
     or v_access_token ~ '[[:space:][:cntrl:]]' then
    raise exception 'A valid WhatsApp access token is required.' using errcode = '22023';
  end if;
  if char_length(v_verified_name) < 1
     or char_length(v_verified_name) > 256
     or v_verified_name ~ '[[:cntrl:]]'
     or char_length(v_display_phone_number) < 5
     or char_length(v_display_phone_number) > 64
     or v_display_phone_number ~ '[[:cntrl:]]'
     or (v_quality_rating <> '' and v_quality_rating not in ('GREEN', 'YELLOW', 'RED', 'NA', 'UNKNOWN')) then
    raise exception 'Meta ownership evidence is invalid.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'phone_number_id', ti.external_account_id,
    'waba_id', ti.whatsapp_business_account_id,
    'graph_api_version', ti.graph_api_version,
    'verified', ti.binding_verified_at is not null,
    'active', ti.is_active
  )
    into v_old_value
  from public.tenant_integrations ti
  where ti.tenant_id = p_tenant_id
    and ti.provider = 'whatsapp'
  for update;

  -- The immutable-binding trigger requires an explicit deactivation before a
  -- verified route can be replaced. Both statements remain one transaction.
  update public.tenant_integrations
     set is_active = false,
         connection_status = 'disabled',
         binding_verified_at = null,
         binding_verified_by = null,
         binding_fingerprint = null,
         binding_verification_evidence = '{}'::jsonb,
         updated_by = p_actor_id,
         updated_at = now()
   where tenant_id = p_tenant_id
     and provider = 'whatsapp';

  v_fingerprint := encode(digest(
    v_phone_number_id || '|' || v_waba_id || '|' || v_graph_version,
    'sha256'
  ), 'hex');
  v_evidence := jsonb_build_object(
    'phone_number_id', v_phone_number_id,
    'waba_id', v_waba_id,
    'graph_api_version', v_graph_version,
    'code_verification_status', 'VERIFIED',
    'verified_name', v_verified_name,
    'display_phone_number', v_display_phone_number,
    'quality_rating', nullif(v_quality_rating, '')
  );

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
    updated_at,
    binding_verified_at,
    binding_verified_by,
    binding_fingerprint,
    binding_verification_evidence
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
    'healthy',
    now(),
    null,
    true,
    p_actor_id,
    now(),
    now(),
    p_actor_id,
    v_fingerprint,
    v_evidence
  )
  on conflict (tenant_id, provider) do update
  set credentials = excluded.credentials,
      external_account_id = excluded.external_account_id,
      whatsapp_business_account_id = excluded.whatsapp_business_account_id,
      graph_api_version = excluded.graph_api_version,
      connection_status = 'healthy',
      last_checked_at = now(),
      last_error = null,
      is_active = true,
      updated_by = p_actor_id,
      updated_at = now(),
      binding_verified_at = now(),
      binding_verified_by = p_actor_id,
      binding_fingerprint = v_fingerprint,
      binding_verification_evidence = v_evidence
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
  set credentials = excluded.credentials,
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
    'tenant_integration.whatsapp.verify',
    'tenant_integration',
    v_integration_id,
    coalesce(v_old_value, '{}'::jsonb),
    jsonb_build_object(
      'provider', 'whatsapp',
      'phone_number_id', v_phone_number_id,
      'waba_id', v_waba_id,
      'graph_api_version', v_graph_version,
      'verified', true,
      'active', true,
      'verified_name', v_verified_name,
      'display_phone_number', v_display_phone_number,
      'quality_rating', nullif(v_quality_rating, '')
    )
  );

  return v_integration_id;
end;
$$;

create or replace function public.fail_tenant_whatsapp_binding_verification(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration_id uuid;
  v_reason text := lower(btrim(coalesce(p_reason, 'verification_failed')));
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
  if v_reason !~ '^[a-z0-9_]{1,64}$' then
    v_reason := 'verification_failed';
  end if;

  select ti.id
    into v_integration_id
  from public.tenant_integrations ti
  where ti.tenant_id = p_tenant_id
    and ti.provider = 'whatsapp'
  for update;

  if not found then
    return null;
  end if;

  update public.tenant_integrations
     set is_active = false,
         connection_status = 'disabled',
         binding_verified_at = null,
         binding_verified_by = null,
         binding_fingerprint = null,
         binding_verification_evidence = '{}'::jsonb,
         last_checked_at = now(),
         last_error = 'Meta ownership verification failed: ' || v_reason,
         updated_by = p_actor_id,
         updated_at = now()
   where id = v_integration_id
     and tenant_id = p_tenant_id
     and provider = 'whatsapp';

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
    'tenant_integration.whatsapp.verification_failed',
    'tenant_integration',
    v_integration_id,
    jsonb_build_object('provider', 'whatsapp', 'active', true),
    jsonb_build_object(
      'provider', 'whatsapp',
      'verified', false,
      'active', false,
      'reason', v_reason
    )
  );

  return v_integration_id;
end;
$$;

create or replace function public.resolve_verified_whatsapp_tenant(
  p_phone_number_id text,
  p_waba_id text
)
returns table(integration_id uuid, tenant_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ti.id, ti.tenant_id
  from public.tenant_integrations ti
  where auth.role() = 'service_role'
    and btrim(coalesce(p_phone_number_id, '')) ~ '^[0-9]{5,32}$'
    and btrim(coalesce(p_waba_id, '')) ~ '^[0-9]{5,32}$'
    and ti.provider = 'whatsapp'
    and ti.external_account_id = btrim(coalesce(p_phone_number_id, ''))
    and ti.whatsapp_business_account_id = btrim(coalesce(p_waba_id, ''))
    and ti.is_active = true
    and ti.connection_status = 'healthy'
    and ti.binding_verified_at is not null
    and ti.binding_fingerprint = encode(digest(
      ti.external_account_id || '|' || ti.whatsapp_business_account_id || '|' || ti.graph_api_version,
      'sha256'
    ), 'hex')
    and ti.binding_verification_evidence ->> 'phone_number_id' = ti.external_account_id
    and ti.binding_verification_evidence ->> 'waba_id' = ti.whatsapp_business_account_id
    and ti.binding_verification_evidence ->> 'code_verification_status' = 'VERIFIED'
  limit 2;
$$;

revoke all on function public.activate_verified_tenant_whatsapp_binding(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.activate_verified_tenant_whatsapp_binding(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text
) to service_role;

revoke all on function public.fail_tenant_whatsapp_binding_verification(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_tenant_whatsapp_binding_verification(uuid, uuid, text)
  to service_role;

revoke all on function public.resolve_verified_whatsapp_tenant(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_verified_whatsapp_tenant(text, text)
  to service_role;

comment on function public.activate_verified_tenant_whatsapp_binding(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text
) is 'Activates an immutable WhatsApp phone/WABA binding after server-side Meta Graph verification.';
comment on function public.fail_tenant_whatsapp_binding_verification(uuid, uuid, text) is
  'Fail-closed deactivation for unsuccessful or unavailable Meta ownership verification.';
comment on function public.resolve_verified_whatsapp_tenant(text, text) is
  'Service-only exact phone/WABA tenant resolution restricted to healthy verified bindings.';

notify pgrst, 'reload schema';
