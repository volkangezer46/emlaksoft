-- Tenant integration secret boundary.
--
-- This migration separates credentials from tenant-visible integration metadata.
-- `tenant_integrations.credentials` is retained only as a backwards-compatible,
-- masked metadata projection for the current settings UI. Raw values live in a
-- service-role-only table. This is an access-control boundary, not application-
-- level encryption; stronger at-rest protection requires a managed key/Vault.

create table if not exists public.tenant_integration_secrets (
  integration_id uuid primary key
    references public.tenant_integrations(id) on delete cascade,
  credentials jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_integration_secrets enable row level security;
revoke all privileges on table public.tenant_integration_secrets
  from public, anon, authenticated;
grant all privileges on table public.tenant_integration_secrets
  to service_role;

comment on table public.tenant_integration_secrets is
  'Service-role-only tenant integration credentials. Access isolation only; values are not application-encrypted without a managed key/Vault.';

-- Mask the handful of compatibility fields consumed by the current Netgsm UI.
-- The helper is intentionally not exposed as an API RPC.
create or replace function public.mask_tenant_integration_credentials(
  p_provider text,
  p_credentials jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_credentials is null or p_credentials = '{}'::jsonb then '{}'::jsonb
    when lower(btrim(coalesce(p_provider, ''))) = 'netgsm' then
      jsonb_strip_nulls(jsonb_build_object(
        'configured', true,
        'usercode', case
          when nullif(btrim(p_credentials ->> 'usercode'), '') is null then null
          when char_length(btrim(p_credentials ->> 'usercode')) <= 4 then '••••'
          else '••••' || right(btrim(p_credentials ->> 'usercode'), 4)
        end,
        'password', case
          when nullif(btrim(p_credentials ->> 'password'), '') is null then null
          else 'configured'
        end,
        'msgheader', case
          when nullif(btrim(p_credentials ->> 'msgheader'), '') is null then null
          when char_length(btrim(p_credentials ->> 'msgheader')) <= 4 then '••••'
          else '••••' || right(btrim(p_credentials ->> 'msgheader'), 4)
        end
      ))
    else jsonb_build_object('configured', true)
  end;
$$;

revoke all privileges on function public.mask_tenant_integration_credentials(text, jsonb)
  from public, anon, authenticated, service_role;

-- Copy legacy plaintext first. Re-runs never overwrite an already-populated
-- secret; an empty partial-migration row can still be safely repaired.
insert into public.tenant_integration_secrets (
  integration_id,
  credentials,
  created_at,
  updated_at
)
select
  ti.id,
  ti.credentials,
  ti.created_at,
  ti.updated_at
from public.tenant_integrations ti
where ti.credentials is distinct from '{}'::jsonb
on conflict (integration_id) do update
set
  credentials = excluded.credentials,
  updated_at = greatest(
    public.tenant_integration_secrets.updated_at,
    excluded.updated_at
  )
where public.tenant_integration_secrets.credentials = '{}'::jsonb;

-- Preserve legacy webhook/account routing metadata before replacing plaintext.
-- Canonically duplicated active accounts are deliberately left unset instead
-- of guessing which tenant owns an inbound event.
with account_candidates as (
  select
    ti.id,
    ti.tenant_id,
    ti.provider,
    ti.is_active,
    coalesce(
      nullif(btrim(ti.external_account_id), ''),
      nullif(btrim(ti.credentials ->> 'phone_number_id'), ''),
      nullif(btrim(ti.credentials ->> 'phoneNumberId'), ''),
      nullif(btrim(ti.credentials ->> 'phone_id'), ''),
      nullif(btrim(ti.credentials ->> 'inbound_number'), ''),
      nullif(btrim(ti.credentials ->> 'receiver'), '')
    ) as account_id
  from public.tenant_integrations ti
), canonical_accounts as (
  select
    c.*,
    lower(regexp_replace(c.account_id, '[[:space:]()+._-]+', '', 'g')) as account_key,
    lower(btrim(c.provider)) as provider_key
  from account_candidates c
  where c.account_id is not null
), account_ownership as (
  select
    ca.provider_key,
    ca.account_key,
    count(*) as integration_count,
    count(distinct ca.tenant_id) as tenant_count
  from canonical_accounts ca
  where ca.is_active and ca.account_key <> ''
  group by ca.provider_key, ca.account_key
)
update public.tenant_integrations ti
set
  external_account_id = case
    when ao.tenant_count > 1 then null
    else ca.account_id
  end,
  connection_status = case
    when ao.tenant_count > 1 then 'degraded'
    else ti.connection_status
  end,
  last_error = case
    when ao.tenant_count > 1 then 'External account ownership is ambiguous; manual review required.'
    else ti.last_error
  end
from canonical_accounts ca
join account_ownership ao
  on ao.provider_key = ca.provider_key
 and ao.account_key = ca.account_key
where ti.id = ca.id
  and ca.is_active
  and (
    ao.tenant_count > 1
    or (
      ao.tenant_count = 1
      and ao.integration_count = 1
      and nullif(btrim(ti.external_account_id), '') is null
    )
  );

-- Replace every successfully isolated legacy payload with safe compatibility
-- metadata. The plaintext remains available only through the secret table.
update public.tenant_integrations ti
set credentials = public.mask_tenant_integration_credentials(
  ti.provider,
  tis.credentials
)
from public.tenant_integration_secrets tis
where tis.integration_id = ti.id;

-- Prevent any future code path (including service-role code) from putting raw
-- values back into the legacy metadata column.
create or replace function public.enforce_masked_tenant_integration_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.credentials is distinct from public.mask_tenant_integration_credentials(
    new.provider,
    new.credentials
  ) then
    raise exception 'tenant_integrations.credentials accepts masked metadata only.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all privileges on function public.enforce_masked_tenant_integration_metadata()
  from public, anon, authenticated, service_role;

drop trigger if exists tenant_integrations_masked_metadata_only
  on public.tenant_integrations;
create trigger tenant_integrations_masked_metadata_only
before insert or update of credentials on public.tenant_integrations
for each row execute function public.enforce_masked_tenant_integration_metadata();

-- Remove the legacy authenticated ALL grant. Explicit same-tenant metadata
-- reads continue through the existing RLS policy; no authenticated DML remains.
drop policy if exists tenant_integrations_insert on public.tenant_integrations;
drop policy if exists tenant_integrations_update on public.tenant_integrations;
drop policy if exists tenant_integrations_delete on public.tenant_integrations;

revoke all privileges on table public.tenant_integrations
  from public, anon, authenticated;
grant select (
  id,
  tenant_id,
  provider,
  credentials,
  is_active,
  updated_by,
  created_at,
  updated_at,
  external_account_id,
  connection_status,
  last_checked_at,
  last_error
) on table public.tenant_integrations to authenticated;
grant all privileges on table public.tenant_integrations to service_role;

comment on column public.tenant_integrations.credentials is
  'Deprecated compatibility metadata only: configured flags and masked values. Raw credentials are forbidden by trigger.';

-- Atomic server-only write. The calling Server Action supplies the authenticated
-- actor after requirePermission; the database validates tenant/actor binding too.
create or replace function public.upsert_tenant_integration_secret(
  p_tenant_id uuid,
  p_provider text,
  p_credentials jsonb,
  p_actor_id uuid,
  p_external_account_id text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration_id uuid;
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_credentials jsonb := coalesce(p_credentials, '{}'::jsonb);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_tenant_id is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'Tenant not found.' using errcode = '42501';
  end if;

  if p_actor_id is null or not (
    exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id and p.tenant_id = p_tenant_id
    )
    or exists (
      select 1
      from public.platform_staff ps
      where ps.id = p_actor_id and ps.is_active = true
    )
  ) then
    raise exception 'Actor is not authorized for this tenant.' using errcode = '42501';
  end if;

  if v_provider = '' then
    raise exception 'Provider is required.' using errcode = '22023';
  end if;

  if jsonb_typeof(v_credentials) <> 'object' or v_credentials = '{}'::jsonb then
    raise exception 'Credentials must be a non-empty JSON object.' using errcode = '22023';
  end if;

  insert into public.tenant_integrations (
    tenant_id,
    provider,
    credentials,
    external_account_id,
    connection_status,
    last_error,
    is_active,
    updated_by,
    updated_at
  ) values (
    p_tenant_id,
    v_provider,
    public.mask_tenant_integration_credentials(v_provider, v_credentials),
    nullif(btrim(coalesce(p_external_account_id, '')), ''),
    'configured',
    null,
    true,
    p_actor_id,
    now()
  )
  on conflict (tenant_id, provider) do update
  set
    credentials = excluded.credentials,
    external_account_id = excluded.external_account_id,
    connection_status = 'configured',
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
    v_credentials,
    now()
  )
  on conflict (integration_id) do update
  set credentials = excluded.credentials, updated_at = now();

  return v_integration_id;
end;
$$;

create or replace function public.delete_tenant_integration_secret(
  p_tenant_id uuid,
  p_provider text,
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
  v_provider text := lower(btrim(coalesce(p_provider, '')));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_tenant_id is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'Tenant not found.' using errcode = '42501';
  end if;

  if p_actor_id is null or not (
    exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id and p.tenant_id = p_tenant_id
    )
    or exists (
      select 1
      from public.platform_staff ps
      where ps.id = p_actor_id and ps.is_active = true
    )
  ) then
    raise exception 'Actor is not authorized for this tenant.' using errcode = '42501';
  end if;

  select ti.id
    into v_integration_id
  from public.tenant_integrations ti
  where ti.tenant_id = p_tenant_id
    and ti.provider = v_provider
  for update;

  if not found then
    return null;
  end if;

  delete from public.tenant_integrations ti
  where ti.id = v_integration_id and ti.tenant_id = p_tenant_id;

  return v_integration_id;
end;
$$;

revoke all privileges on function public.upsert_tenant_integration_secret(uuid, text, jsonb, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.upsert_tenant_integration_secret(uuid, text, jsonb, uuid, text)
  to service_role;

revoke all privileges on function public.delete_tenant_integration_secret(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_tenant_integration_secret(uuid, text, uuid)
  to service_role;

comment on function public.upsert_tenant_integration_secret(uuid, text, jsonb, uuid, text) is
  'Service-role-only atomic metadata/secret upsert. The actor is validated against the tenant.';
comment on function public.delete_tenant_integration_secret(uuid, text, uuid) is
  'Service-role-only integration delete; secret deletion follows through ON DELETE CASCADE.';

notify pgrst, 'reload schema';
