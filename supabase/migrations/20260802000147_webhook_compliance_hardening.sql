-- Webhook and compliance hardening.
--
-- 1. Netgsm inbound messages are routed only by the provider-owned receiver.
-- 2. Webhook inbox rows can explicitly quarantine ambiguous/unusable events.
-- 3. Public lead consent and token revocation evidence are service-only.
-- 4. IYS state remains a fast projection while every transition is append-only.
-- 5. KVKK anonymization enqueues private Storage objects for retryable deletion.

-- ---------------------------------------------------------------------------
-- Netgsm receiver canonicalization and unambiguous ownership
-- ---------------------------------------------------------------------------

create or replace function public.canonical_netgsm_receiver(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(p_value, '[^0-9]', '', 'g');
begin
  if char_length(v_digits) = 12 and left(v_digits, 2) = '90' then
    return substr(v_digits, 3);
  end if;
  if char_length(v_digits) = 11 and left(v_digits, 1) = '0' then
    return substr(v_digits, 2);
  end if;
  return v_digits;
end;
$$;

revoke all privileges on function public.canonical_netgsm_receiver(text)
  from public, anon, authenticated;
grant execute on function public.canonical_netgsm_receiver(text) to service_role;

-- If two active records canonicalize to the same subscriber number, neither is
-- allowed to own inbound traffic. An operator must repair the account mapping.
with duplicate_receivers as (
  select public.canonical_netgsm_receiver(ti.external_account_id) as receiver
  from public.tenant_integrations ti
  where lower(btrim(ti.provider)) = 'netgsm'
    and ti.is_active
    and nullif(btrim(ti.external_account_id), '') is not null
  group by public.canonical_netgsm_receiver(ti.external_account_id)
  having count(*) > 1
)
update public.tenant_integrations ti
set
  external_account_id = null,
  connection_status = 'degraded',
  last_error = 'Netgsm inbound receiver ownership is ambiguous; manual review required.',
  updated_at = now()
from duplicate_receivers d
where lower(btrim(ti.provider)) = 'netgsm'
  and ti.is_active
  and public.canonical_netgsm_receiver(ti.external_account_id) = d.receiver;

update public.tenant_integrations ti
set external_account_id = public.canonical_netgsm_receiver(ti.external_account_id)
where lower(btrim(ti.provider)) = 'netgsm'
  and nullif(btrim(ti.external_account_id), '') is not null
  and ti.external_account_id is distinct from public.canonical_netgsm_receiver(ti.external_account_id);

create or replace function public.normalize_tenant_integration_external_account()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_receiver text;
begin
  if lower(btrim(coalesce(new.provider, ''))) <> 'netgsm'
    or nullif(btrim(coalesce(new.external_account_id, '')), '') is null then
    return new;
  end if;

  v_receiver := public.canonical_netgsm_receiver(new.external_account_id);
  if char_length(v_receiver) < 4 or char_length(v_receiver) > 20 then
    raise exception 'Netgsm inbound receiver must contain 4-20 digits.'
      using errcode = '22023';
  end if;
  new.external_account_id := v_receiver;
  return new;
end;
$$;

revoke all privileges on function public.normalize_tenant_integration_external_account()
  from public, anon, authenticated;

drop trigger if exists tenant_integrations_normalize_external_account
  on public.tenant_integrations;
create trigger tenant_integrations_normalize_external_account
before insert or update of provider, external_account_id
on public.tenant_integrations
for each row execute function public.normalize_tenant_integration_external_account();

alter table public.webhook_events
  add column if not exists routing_key text,
  add column if not exists quarantined_at timestamptz;

alter table public.webhook_events
  drop constraint if exists webhook_events_status_check;
alter table public.webhook_events
  add constraint webhook_events_status_check
  check (status in (
    'received', 'processing', 'processed', 'ignored', 'unmatched', 'failed', 'quarantined'
  ));

create index if not exists idx_webhook_events_quarantine
  on public.webhook_events(provider, received_at desc)
  where status = 'quarantined';

-- ---------------------------------------------------------------------------
-- Public lead consent evidence and token revocation ledger
-- ---------------------------------------------------------------------------

create table if not exists public.public_lead_consent_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  consent_scope text not null,
  consent_version text not null,
  source text not null,
  ip_hash text,
  user_agent_hash text,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint public_lead_consent_scope_check check (
    consent_scope in ('lead_intake', 'valuation_lead')
  ),
  constraint public_lead_consent_version_check check (
    char_length(btrim(consent_version)) between 1 and 80
  ),
  constraint public_lead_consent_source_check check (
    char_length(btrim(source)) between 1 and 80
  ),
  constraint public_lead_consent_ip_hash_check check (
    ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint public_lead_consent_user_agent_hash_check check (
    user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'
  )
);

create index if not exists idx_public_lead_consent_tenant_customer
  on public.public_lead_consent_events(tenant_id, customer_id, accepted_at desc);

alter table public.public_lead_consent_events enable row level security;
revoke all privileges on table public.public_lead_consent_events
  from public, anon, authenticated;
grant select, insert on table public.public_lead_consent_events to service_role;

create table if not exists public.lead_capture_token_revocations (
  token_hash text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  revoked_by uuid,
  reason text not null default 'rotated',
  revoked_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year'),
  constraint lead_capture_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint lead_capture_token_reason_check check (
    reason in ('rotated', 'disabled', 'compromised', 'manual')
  )
);

create index if not exists idx_lead_capture_token_revocations_expiry
  on public.lead_capture_token_revocations(expires_at);

alter table public.lead_capture_token_revocations enable row level security;
revoke all privileges on table public.lead_capture_token_revocations
  from public, anon, authenticated;
grant select, insert, delete on table public.lead_capture_token_revocations to service_role;

create or replace function public.rotate_lead_capture_token(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_new_token text,
  p_reason text default 'rotated'
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_token text;
  v_new_token text := btrim(coalesce(p_new_token, ''));
  v_reason text := lower(btrim(coalesce(p_reason, 'rotated')));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.is_active = true
  ) then
    raise exception 'Actor is not authorized for this tenant.' using errcode = '42501';
  end if;
  if char_length(v_new_token) < 32 or char_length(v_new_token) > 128
    or v_new_token !~ '^[A-Za-z0-9._~-]+$' then
    raise exception 'Invalid lead token.' using errcode = '22023';
  end if;
  if v_reason not in ('rotated', 'disabled', 'compromised', 'manual') then
    raise exception 'Invalid revocation reason.' using errcode = '22023';
  end if;

  select t.lead_capture_token into v_old_token
  from public.tenants t
  where t.id = p_tenant_id
  for update;
  if not found then
    raise exception 'Tenant not found.' using errcode = 'P0002';
  end if;

  if nullif(btrim(coalesce(v_old_token, '')), '') is not null then
    insert into public.lead_capture_token_revocations (
      token_hash, tenant_id, revoked_by, reason
    ) values (
      encode(digest(v_old_token, 'sha256'), 'hex'),
      p_tenant_id,
      p_actor_id,
      v_reason
    ) on conflict (token_hash) do nothing;
  end if;

  update public.tenants
  set lead_capture_token = v_new_token
  where id = p_tenant_id;

  return v_new_token;
end;
$$;

revoke all privileges on function public.rotate_lead_capture_token(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rotate_lead_capture_token(uuid, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Append-only IYS transitions
-- ---------------------------------------------------------------------------

create table if not exists public.iys_consent_events (
  id uuid primary key default gen_random_uuid(),
  -- Deliberately no cascading FK: evidence must survive later tenant/customer
  -- lifecycle operations and can only be removed by an explicit retention act.
  tenant_id uuid not null,
  customer_id uuid not null,
  channel text not null check (channel in ('sms', 'email', 'whatsapp', 'call')),
  from_status text check (from_status is null or from_status in ('granted', 'denied', 'unknown', 'pending')),
  to_status text not null check (to_status in ('granted', 'denied', 'unknown', 'pending')),
  source text not null,
  actor_id uuid,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_iys_consent_events_tenant_customer
  on public.iys_consent_events(tenant_id, customer_id, occurred_at desc);

alter table public.iys_consent_events enable row level security;
revoke all privileges on table public.iys_consent_events
  from public, anon, authenticated;
grant select, insert on table public.iys_consent_events to service_role;

create or replace function public.reject_iys_consent_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'IYS consent events are append-only.' using errcode = '42501';
end;
$$;

revoke all privileges on function public.reject_iys_consent_event_mutation()
  from public, anon, authenticated;

drop trigger if exists iys_consent_events_append_only on public.iys_consent_events;
create trigger iys_consent_events_append_only
before update or delete on public.iys_consent_events
for each row execute function public.reject_iys_consent_event_mutation();

create or replace function public.audit_iys_consent_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_text text := nullif(current_setting('app.iys_actor_id', true), '');
  v_source text := nullif(current_setting('app.iys_event_source', true), '');
  v_evidence_text text := nullif(current_setting('app.iys_event_evidence', true), '');
  v_actor uuid;
  v_evidence jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if v_actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_actor := v_actor_text::uuid;
  end if;
  if v_evidence_text is not null then
    begin
      v_evidence := v_evidence_text::jsonb;
    exception when others then
      v_evidence := '{}'::jsonb;
    end;
  end if;

  if v_source is null then
    if new.status = 'denied' and exists (
      select 1 from public.customers c
      where c.id = new.customer_id
        and c.tenant_id = new.tenant_id
        and c.deleted_at is not null
        and lower(c.full_name) like 'anonim%'
    ) then
      v_source := 'kvkk_erasure';
    else
      v_source := coalesce(nullif(btrim(new.source), ''), 'system');
    end if;
  end if;

  insert into public.iys_consent_events (
    tenant_id,
    customer_id,
    channel,
    from_status,
    to_status,
    source,
    actor_id,
    evidence,
    occurred_at
  ) values (
    new.tenant_id,
    new.customer_id,
    new.channel,
    case when tg_op = 'INSERT' then null else old.status end,
    new.status,
    left(v_source, 80),
    v_actor,
    v_evidence,
    now()
  );

  return new;
end;
$$;

revoke all privileges on function public.audit_iys_consent_transition()
  from public, anon, authenticated;

drop trigger if exists iys_consents_transition_audit on public.iys_consents;
create trigger iys_consents_transition_audit
after insert or update of status on public.iys_consents
for each row execute function public.audit_iys_consent_transition();

create or replace function public.transition_iys_consent(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_channel text,
  p_status text,
  p_source text,
  p_actor_id uuid,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_old_status text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or not (
    exists (
      select 1 from public.profiles p
      where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.is_active = true
    ) or exists (
      select 1 from public.platform_staff ps
      where ps.id = p_actor_id and ps.is_active = true
    )
  ) then
    raise exception 'Actor is not authorized for this tenant.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = p_tenant_id and c.deleted_at is null
  ) then
    raise exception 'Customer not found in tenant.' using errcode = 'P0002';
  end if;
  if v_channel not in ('sms', 'email', 'whatsapp', 'call') then
    raise exception 'Invalid IYS channel.' using errcode = '22023';
  end if;
  if v_status not in ('granted', 'denied', 'unknown', 'pending') then
    raise exception 'Invalid IYS status.' using errcode = '22023';
  end if;
  if char_length(v_source) < 1 or char_length(v_source) > 80 then
    raise exception 'Invalid IYS source.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '{}'::jsonb)) <> 'object'
    or pg_column_size(coalesce(p_evidence, '{}'::jsonb)) > 8192 then
    raise exception 'Invalid IYS evidence.' using errcode = '22023';
  end if;

  select c.status into v_old_status
  from public.iys_consents c
  where c.tenant_id = p_tenant_id
    and c.customer_id = p_customer_id
    and c.channel = v_channel
  for update;

  if found and v_old_status = v_status then
    return jsonb_build_object('ok', true, 'already', true, 'status', v_status);
  end if;

  perform set_config('app.iys_actor_id', p_actor_id::text, true);
  perform set_config('app.iys_event_source', v_source, true);
  perform set_config('app.iys_event_evidence', coalesce(p_evidence, '{}'::jsonb)::text, true);

  insert into public.iys_consents (
    tenant_id,
    customer_id,
    channel,
    status,
    source,
    granted_at,
    revoked_at,
    meta
  ) values (
    p_tenant_id,
    p_customer_id,
    v_channel,
    v_status,
    v_source,
    case when v_status = 'granted' then v_now else null end,
    case when v_status = 'denied' then v_now else null end,
    '{}'::jsonb
  )
  on conflict (tenant_id, customer_id, channel) do update
  set
    status = excluded.status,
    source = excluded.source,
    granted_at = case
      when excluded.status = 'granted' then v_now
      else public.iys_consents.granted_at
    end,
    revoked_at = case
      when excluded.status = 'denied' then v_now
      else null
    end;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'fromStatus', v_old_status,
    'status', v_status
  );
end;
$$;

revoke insert, update, delete, truncate, references, trigger
  on table public.iys_consents from authenticated;
grant select on table public.iys_consents to authenticated;

revoke all privileges on function public.transition_iys_consent(
  uuid, uuid, text, text, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.transition_iys_consent(
  uuid, uuid, text, text, text, uuid, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- Retryable KVKK Storage deletion outbox
-- ---------------------------------------------------------------------------

create table if not exists public.storage_deletion_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid,
  bucket text not null,
  object_path text not null,
  source_table text not null,
  source_id uuid,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, object_path)
);

create index if not exists idx_storage_deletion_outbox_queue
  on public.storage_deletion_outbox(next_attempt_at, created_at)
  where status in ('pending', 'retry', 'processing');

alter table public.storage_deletion_outbox enable row level security;
revoke all privileges on table public.storage_deletion_outbox
  from public, anon, authenticated;
grant select, insert, update, delete on table public.storage_deletion_outbox
  to service_role;

create or replace function public.enqueue_anonymized_customer_storage()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not (
    old.full_name is distinct from new.full_name
    and new.deleted_at is not null
    and new.phone is null
    and new.email is null
    and lower(new.full_name) like 'anonim%'
  ) then
    return new;
  end if;

  insert into public.storage_deletion_outbox (
    tenant_id,
    customer_id,
    bucket,
    object_path,
    source_table,
    source_id,
    reason
  )
  select
    cf.tenant_id,
    cf.customer_id,
    'customer-files',
    cf.storage_path,
    'customer_files',
    cf.id,
    'kvkk_erasure'
  from public.customer_files cf
  where cf.tenant_id = new.tenant_id
    and cf.customer_id = new.id
    and nullif(btrim(cf.storage_path), '') is not null
  on conflict (bucket, object_path) do nothing;

  delete from public.customer_files cf
  where cf.tenant_id = new.tenant_id and cf.customer_id = new.id;

  return new;
end;
$$;

revoke all privileges on function public.enqueue_anonymized_customer_storage()
  from public, anon, authenticated;

drop trigger if exists customers_enqueue_storage_deletion on public.customers;
create trigger customers_enqueue_storage_deletion
after update of full_name, phone, email, deleted_at on public.customers
for each row execute function public.enqueue_anonymized_customer_storage();

create or replace function public.claim_storage_deletion_jobs(p_limit integer default 50)
returns setof public.storage_deletion_outbox
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Claim limit must be between 1 and 100.' using errcode = '22023';
  end if;

  return query
  with claimable as (
    select q.id
    from public.storage_deletion_outbox q
    where (
      q.status in ('pending', 'retry') and q.next_attempt_at <= now()
    ) or (
      q.status = 'processing' and q.last_attempt_at < now() - interval '30 minutes'
    )
    order by q.next_attempt_at, q.created_at
    for update skip locked
    limit p_limit
  )
  update public.storage_deletion_outbox q
  set
    status = 'processing',
    attempt_count = q.attempt_count + 1,
    last_attempt_at = now(),
    updated_at = now()
  from claimable c
  where q.id = c.id
  returning q.*;
end;
$$;

revoke all privileges on function public.claim_storage_deletion_jobs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_storage_deletion_jobs(integer) to service_role;

create or replace function public.run_operational_retention()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_revocations integer := 0;
  v_outbox integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  v_result := public.purge_operational_data();

  delete from public.lead_capture_token_revocations
  where expires_at < now();
  get diagnostics v_revocations = row_count;

  delete from public.storage_deletion_outbox
  where status = 'completed'
    and completed_at < now() - interval '90 days';
  get diagnostics v_outbox = row_count;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'lead_token_revocations_deleted', v_revocations,
    'storage_outbox_rows_deleted', v_outbox
  );
end;
$$;

revoke all privileges on function public.run_operational_retention()
  from public, anon, authenticated, service_role;
grant execute on function public.run_operational_retention() to service_role;

notify pgrst, 'reload schema';
