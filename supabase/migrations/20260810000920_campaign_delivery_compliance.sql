-- Campaign delivery compliance and durable recipient leases.
--
-- This is intentionally a forward-only migration. The original campaign
-- schema and claim_campaign_delivery RPC remain immutable; the worker keeps
-- using that RPC for campaign ownership and uses the functions below for
-- recipient ownership, last-moment consent verification and completion.

alter table public.campaign_recipients
  add column if not exists delivery_state text not null default 'queued',
  add column if not exists delivery_key uuid not null default gen_random_uuid(),
  add column if not exists lease_token uuid,
  add column if not exists lease_started_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists blocked_at timestamptz,
  add column if not exists consent_checked_at timestamptz,
  add column if not exists consent_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists last_error_code text;

-- Business-initiated WhatsApp campaigns must use an approved Meta template.
-- Existing legacy rows are left unvalidated, but every new/updated row is
-- fail-closed and the delivery verification RPC below also rejects legacy
-- free-text campaigns before provider I/O.
alter table public.campaigns
  add column if not exists whatsapp_template_name text,
  add column if not exists whatsapp_template_language text;

alter table public.campaigns
  drop constraint if exists campaigns_whatsapp_template_contract;
alter table public.campaigns
  add constraint campaigns_whatsapp_template_contract
  check (
    (
      channel::text = 'whatsapp'
      and whatsapp_template_name is not null
      and whatsapp_template_name ~ '^[a-z0-9_]{1,512}$'
      and whatsapp_template_language is not null
      and whatsapp_template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'
      and char_length(message) <= 612
    )
    or (
      channel::text <> 'whatsapp'
      and whatsapp_template_name is null
      and whatsapp_template_language is null
    )
  ) not valid;

update public.campaign_recipients
set delivery_state = case status::text
  when 'sent' then 'sent'
  when 'delivered' then 'sent'
  when 'failed' then 'dead_letter'
  when 'opted_out' then 'blocked'
  else 'queued'
end
where delivery_state = 'queued';

alter table public.campaign_recipients
  drop constraint if exists campaign_recipients_delivery_state_check;
alter table public.campaign_recipients
  add constraint campaign_recipients_delivery_state_check
  check (delivery_state in (
    'queued', 'processing', 'retry', 'sent', 'blocked', 'skipped', 'dead_letter'
  )) not valid;
alter table public.campaign_recipients
  validate constraint campaign_recipients_delivery_state_check;

create unique index if not exists uq_campaign_recipients_delivery_key
  on public.campaign_recipients(delivery_key);

create index if not exists idx_campaign_recipients_delivery_due
  on public.campaign_recipients(campaign_id, next_attempt_at, created_at)
  where status = 'pending' and delivery_state in ('queued', 'retry');

create index if not exists idx_campaign_recipients_delivery_lease
  on public.campaign_recipients(campaign_id, lease_started_at)
  where delivery_state = 'processing';

-- Campaign and recipient snapshot are created in one database transaction.
-- The INSERT ... SELECT is not subject to PostgREST's default response row
-- limit, so offices with more than 1,000 eligible customers are not truncated.
create or replace function public.create_campaign_with_recipients(
  p_tenant_id uuid,
  p_created_by uuid,
  p_title text,
  p_channel text,
  p_message text,
  p_filter text default 'all',
  p_whatsapp_template_name text default null,
  p_whatsapp_template_language text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign_id uuid;
  v_recipient_count integer;
  v_title text := btrim(coalesce(p_title, ''));
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_message text := btrim(coalesce(p_message, ''));
  v_filter text := lower(btrim(coalesce(p_filter, 'all')));
  v_whatsapp_template_name text := btrim(coalesce(p_whatsapp_template_name, ''));
  v_whatsapp_template_language text := btrim(coalesce(p_whatsapp_template_language, ''));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    raise exception 'Invalid campaign title.' using errcode = '22023';
  end if;
  if v_channel not in ('sms', 'whatsapp') then
    raise exception 'Campaign provider is not configured for this channel.' using errcode = '22023';
  end if;
  if v_channel = 'sms' and (char_length(v_message) < 1 or char_length(v_message) > 612) then
    raise exception 'Invalid campaign message.' using errcode = '22023';
  end if;
  if v_channel = 'whatsapp' then
    if char_length(v_message) > 612 then
      raise exception 'Invalid WhatsApp template body parameter.' using errcode = '22023';
    end if;
    if v_whatsapp_template_name !~ '^[a-z0-9_]{1,512}$'
       or v_whatsapp_template_language !~ '^[a-z]{2,3}(_[A-Z]{2})?$' then
      raise exception 'Approved WhatsApp template name and language are required.' using errcode = '22023';
    end if;
  else
    v_whatsapp_template_name := '';
    v_whatsapp_template_language := '';
  end if;
  if v_filter not in ('all', 'type:alici', 'type:satici', 'type:kira') then
    raise exception 'Invalid campaign audience filter.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status in ('trial', 'active', 'past_due')
  ) then
    raise exception 'Tenant is not eligible for campaign creation.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_created_by
      and p.tenant_id = p_tenant_id
      and p.is_active = true
  ) then
    raise exception 'Campaign actor is not active in tenant.' using errcode = '42501';
  end if;

  insert into public.campaigns (
    tenant_id,
    created_by,
    title,
    channel,
    message,
    whatsapp_template_name,
    whatsapp_template_language,
    status,
    total_count
  ) values (
    p_tenant_id,
    p_created_by,
    v_title,
    v_channel::public.campaign_channel,
    v_message,
    nullif(v_whatsapp_template_name, ''),
    nullif(v_whatsapp_template_language, ''),
    'draft',
    0
  )
  returning id into v_campaign_id;

  insert into public.campaign_recipients (
    campaign_id,
    customer_id,
    phone,
    full_name,
    status,
    delivery_state
  )
  select
    v_campaign_id,
    c.id,
    c.phone,
    c.full_name,
    'pending',
    'queued'
  from public.customers c
  where c.tenant_id = p_tenant_id
    and c.deleted_at is null
    and c.blacklist = false
    and nullif(btrim(coalesce(c.phone, '')), '') is not null
    and (
      v_filter = 'all'
      or c.customer_types @> array[split_part(v_filter, ':', 2)]::text[]
    )
  order by c.id;

  get diagnostics v_recipient_count = row_count;
  if v_recipient_count = 0 then
    -- Raising rolls back both the campaign and recipient statement.
    raise exception 'No eligible campaign recipients.' using errcode = '22023';
  end if;

  update public.campaigns
     set total_count = v_recipient_count
   where id = v_campaign_id
     and tenant_id = p_tenant_id;

  return jsonb_build_object(
    'id', v_campaign_id,
    'tenant_id', p_tenant_id,
    'recipient_count', v_recipient_count
  );
end;
$$;

revoke all on function public.create_campaign_with_recipients(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_campaign_with_recipients(uuid, uuid, text, text, text, text, text, text)
  to service_role;

-- Manual send is enqueue-only. Provider I/O is deliberately absent from this
-- function and therefore absent from the user request lifecycle.
create or replace function public.enqueue_campaign_delivery(
  p_campaign_id uuid,
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_pending integer;
begin
  select c.*
    into v_campaign
  from public.campaigns c
  where c.id = p_campaign_id
    and c.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'Campaign not found in tenant.' using errcode = 'P0002';
  end if;

  if v_campaign.status not in ('draft', 'scheduled') then
    raise exception 'Campaign cannot be enqueued from its current state.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status in ('trial', 'active', 'past_due')
  ) then
    raise exception 'Tenant is not eligible for delivery.' using errcode = '42501';
  end if;

  select count(*)::integer
    into v_pending
  from public.campaign_recipients r
  where r.campaign_id = p_campaign_id
    and r.status = 'pending'
    and r.delivery_state in ('queued', 'retry');

  if v_pending = 0 then
    raise exception 'Campaign has no deliverable recipients.' using errcode = '22023';
  end if;

  update public.campaigns
     set status = 'scheduled',
         scheduled_at = now(),
         processing_token = null,
         processing_started_at = null,
         last_error = null
   where id = p_campaign_id
     and tenant_id = p_tenant_id;

  return jsonb_build_object(
    'queued', true,
    'campaign_id', p_campaign_id,
    'tenant_id', p_tenant_id,
    'recipient_count', v_pending
  );
end;
$$;

revoke all on function public.enqueue_campaign_delivery(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_campaign_delivery(uuid, uuid)
  to service_role;

-- Claims exactly one due recipient under the already-owned campaign. A stale
-- processing lease is treated as an unknown provider outcome and dead-lettered
-- instead of being sent a second time. This is the fail-closed idempotency rule.
create or replace function public.claim_campaign_recipient_delivery(
  p_campaign_id uuid,
  p_tenant_id uuid,
  p_processing_token uuid,
  p_lease_seconds integer default 300,
  p_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient_id uuid;
  v_lease_token uuid := gen_random_uuid();
  v_lease interval := make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 1800)));
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts, 5), 10));
begin
  perform 1
  from public.campaigns c
  where c.id = p_campaign_id
    and c.tenant_id = p_tenant_id
    and c.status = 'sending'
    and c.processing_token = p_processing_token
  for update;

  if not found then
    raise exception 'Campaign lease ownership lost.' using errcode = '42501';
  end if;

  update public.campaign_recipients r
     set status = 'failed',
         delivery_state = 'dead_letter',
         dead_lettered_at = now(),
         lease_token = null,
         lease_started_at = null,
         last_error_code = 'unknown_provider_outcome',
         error_msg = 'Önceki teslimat denemesinin sağlayıcı sonucu doğrulanamadı; tekrar gönderim engellendi.'
   where r.campaign_id = p_campaign_id
     and r.delivery_state = 'processing'
     and r.lease_started_at < now() - v_lease;

  update public.campaign_recipients r
     set status = 'failed',
         delivery_state = 'dead_letter',
         dead_lettered_at = now(),
         last_error_code = coalesce(r.last_error_code, 'max_attempts_exceeded'),
         error_msg = coalesce(r.error_msg, 'Azami teslimat denemesi aşıldı.')
   where r.campaign_id = p_campaign_id
     and r.status = 'pending'
     and r.delivery_state in ('queued', 'retry')
     and r.attempt_count >= v_max_attempts;

  select r.id
    into v_recipient_id
  from public.campaign_recipients r
  where r.campaign_id = p_campaign_id
    and r.status = 'pending'
    and r.delivery_state in ('queued', 'retry')
    and r.attempt_count < v_max_attempts
    and r.next_attempt_at <= now()
  order by r.next_attempt_at, r.created_at, r.id
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.campaign_recipients
     set delivery_state = 'processing',
         lease_token = v_lease_token,
         lease_started_at = now(),
         last_attempt_at = now(),
         attempt_count = attempt_count + 1,
         last_error_code = null,
         error_msg = null
   where id = v_recipient_id;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'tenant_id', p_tenant_id,
    'recipient_id', v_recipient_id,
    'lease_token', v_lease_token
  );
end;
$$;

revoke all on function public.claim_campaign_recipient_delivery(uuid, uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_campaign_recipient_delivery(uuid, uuid, uuid, integer, integer)
  to service_role;

-- This RPC is called immediately before the provider request. It verifies the
-- campaign lease, recipient lease, customer/tenant ownership and the channel's
-- current local IYS projection in one locked transaction, then stores evidence.
create or replace function public.verify_campaign_recipient_consent(
  p_campaign_id uuid,
  p_tenant_id uuid,
  p_processing_token uuid,
  p_recipient_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_recipient public.campaign_recipients%rowtype;
  v_customer public.customers%rowtype;
  v_consent public.iys_consents%rowtype;
  v_consent_event_id uuid;
  v_consent_event_at timestamptz;
  v_consent_evidence jsonb;
  v_checked_at timestamptz := clock_timestamp();
  v_address text;
  v_state text;
  v_snapshot jsonb;
begin
  select c.*
    into v_campaign
  from public.campaigns c
  where c.id = p_campaign_id
    and c.tenant_id = p_tenant_id
    and c.status = 'sending'
    and c.processing_token = p_processing_token;

  if not found then
    raise exception 'Campaign lease ownership lost.' using errcode = '42501';
  end if;

  select r.*
    into v_recipient
  from public.campaign_recipients r
  where r.id = p_recipient_id
    and r.campaign_id = p_campaign_id
    and r.delivery_state = 'processing'
    and r.lease_token = p_lease_token
  for update;

  if not found then
    raise exception 'Recipient lease ownership lost.' using errcode = '42501';
  end if;

  -- Legacy WhatsApp campaigns created before this migration may contain only
  -- free text. Never downgrade those rows to a session/text message: a Meta
  -- template name and language are mandatory for campaign delivery.
  if v_campaign.channel::text = 'whatsapp'
     and (
       v_campaign.whatsapp_template_name is null
       or v_campaign.whatsapp_template_name !~ '^[a-z0-9_]{1,512}$'
       or v_campaign.whatsapp_template_language is null
       or v_campaign.whatsapp_template_language !~ '^[a-z]{2,3}(_[A-Z]{2})?$'
     ) then
    v_snapshot := jsonb_build_object(
      'projection', 'campaign_template_policy',
      'status', 'blocked',
      'reason', 'whatsapp_template_invalid',
      'checked_at', v_checked_at
    );
    update public.campaign_recipients
       set status = 'failed',
           delivery_state = 'dead_letter',
           dead_lettered_at = v_checked_at,
           consent_checked_at = v_checked_at,
           consent_snapshot = v_snapshot,
           lease_token = null,
           lease_started_at = null,
           last_error_code = 'whatsapp_template_invalid',
           error_msg = 'WhatsApp campaign template contract is invalid.'
     where id = p_recipient_id;
    return jsonb_build_object(
      'allowed', false,
      'state', 'dead_letter',
      'reason', 'whatsapp_template_invalid'
    );
  end if;

  select c.*
    into v_customer
  from public.customers c
  where c.id = v_recipient.customer_id
    and c.tenant_id = p_tenant_id
    and c.deleted_at is null
    and c.blacklist = false;

  if not found then
    v_snapshot := jsonb_build_object(
      'projection', 'local_iys_consents',
      'status', 'unavailable',
      'reason', 'customer_not_active_in_tenant',
      'checked_at', v_checked_at
    );
    update public.campaign_recipients
       set status = 'failed',
           delivery_state = 'skipped',
           consent_checked_at = v_checked_at,
           consent_snapshot = v_snapshot,
           lease_token = null,
           lease_started_at = null,
           last_error_code = 'customer_unavailable',
           error_msg = 'Müşteri tenant içinde aktif olmadığı için teslimat atlandı.'
     where id = p_recipient_id;
    return jsonb_build_object('allowed', false, 'state', 'skipped', 'reason', 'customer_unavailable');
  end if;

  v_address := case v_campaign.channel::text
    when 'email' then nullif(btrim(coalesce(v_customer.email, '')), '')
    else nullif(btrim(coalesce(v_customer.phone, '')), '')
  end;

  if v_address is null then
    v_snapshot := jsonb_build_object(
      'projection', 'local_iys_consents',
      'status', 'unavailable',
      'reason', 'channel_address_missing',
      'channel', v_campaign.channel::text,
      'checked_at', v_checked_at
    );
    update public.campaign_recipients
       set status = 'failed',
           delivery_state = 'skipped',
           consent_checked_at = v_checked_at,
           consent_snapshot = v_snapshot,
           lease_token = null,
           lease_started_at = null,
           last_error_code = 'channel_address_missing',
           error_msg = 'Kanal adresi bulunmadığı için teslimat atlandı.'
     where id = p_recipient_id;
    return jsonb_build_object('allowed', false, 'state', 'skipped', 'reason', 'channel_address_missing');
  end if;

  select i.*
    into v_consent
  from public.iys_consents i
  where i.tenant_id = p_tenant_id
    and i.customer_id = v_customer.id
    and i.channel = v_campaign.channel::text;

  select e.id, e.occurred_at, e.evidence
    into v_consent_event_id, v_consent_event_at, v_consent_evidence
  from public.iys_consent_events e
  where e.tenant_id = p_tenant_id
    and e.customer_id = v_customer.id
    and e.channel = v_campaign.channel::text
  order by e.occurred_at desc, e.created_at desc, e.id desc
  limit 1;

  v_snapshot := jsonb_build_object(
    'projection', 'local_iys_consents',
    'consent_id', v_consent.id,
    'tenant_id', p_tenant_id,
    'customer_id', v_customer.id,
    'channel', v_campaign.channel::text,
    'status', coalesce(v_consent.status, 'missing'),
    'source', v_consent.source,
    'granted_at', v_consent.granted_at,
    'revoked_at', v_consent.revoked_at,
    'consent_event_id', v_consent_event_id,
    'consent_event_at', v_consent_event_at,
    'evidence_sha256', encode(
      digest(coalesce(v_consent_evidence, v_consent.meta, '{}'::jsonb)::text, 'sha256'),
      'hex'
    ),
    'checked_at', v_checked_at
  );

  if v_consent.id is null
     or v_consent.status <> 'granted'
     or v_consent.revoked_at is not null then
    v_state := case
      when v_consent.status = 'denied' or v_consent.revoked_at is not null then 'blocked'
      else 'skipped'
    end;

    update public.campaign_recipients
       set status = case when v_state = 'blocked' then 'opted_out'::public.recipient_status else 'failed'::public.recipient_status end,
           delivery_state = v_state,
           blocked_at = case when v_state = 'blocked' then v_checked_at else blocked_at end,
           consent_checked_at = v_checked_at,
           consent_snapshot = v_snapshot,
           lease_token = null,
           lease_started_at = null,
           last_error_code = 'iys_consent_not_granted',
           error_msg = 'Kanal izni açıkça verilmediği için teslimat engellendi.'
     where id = p_recipient_id;

    return jsonb_build_object(
      'allowed', false,
      'state', v_state,
      'reason', 'iys_consent_not_granted'
    );
  end if;

  update public.campaign_recipients
     set consent_checked_at = v_checked_at,
         consent_snapshot = v_snapshot,
         phone = case when v_campaign.channel::text in ('sms', 'whatsapp') then v_address else phone end,
         email = case when v_campaign.channel::text = 'email' then v_address else email end
   where id = p_recipient_id;

  return jsonb_build_object(
    'allowed', true,
    'campaign_id', p_campaign_id,
    'tenant_id', p_tenant_id,
    'recipient_id', p_recipient_id,
    'lease_token', p_lease_token,
    'delivery_key', v_recipient.delivery_key,
    'channel', v_campaign.channel::text,
    'address', v_address,
    'message', v_campaign.message,
    'whatsapp_template_name', v_campaign.whatsapp_template_name,
    'whatsapp_template_language', v_campaign.whatsapp_template_language,
    'consent_snapshot', v_snapshot
  );
end;
$$;

revoke all on function public.verify_campaign_recipient_consent(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.verify_campaign_recipient_consent(uuid, uuid, uuid, uuid, uuid)
  to service_role;

create or replace function public.complete_campaign_recipient_delivery(
  p_campaign_id uuid,
  p_tenant_id uuid,
  p_processing_token uuid,
  p_recipient_id uuid,
  p_lease_token uuid,
  p_success boolean,
  p_provider text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_retryable boolean default false,
  p_max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient public.campaign_recipients%rowtype;
  v_retry boolean;
  v_next_attempt timestamptz;
  v_state text;
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts, 5), 10));
begin
  perform 1
  from public.campaigns c
  where c.id = p_campaign_id
    and c.tenant_id = p_tenant_id
    and c.status = 'sending'
    and c.processing_token = p_processing_token;

  if not found then
    raise exception 'Campaign lease ownership lost.' using errcode = '42501';
  end if;

  select r.*
    into v_recipient
  from public.campaign_recipients r
  where r.id = p_recipient_id
    and r.campaign_id = p_campaign_id
    and r.delivery_state = 'processing'
    and r.lease_token = p_lease_token
  for update;

  if not found then
    raise exception 'Recipient lease ownership lost.' using errcode = '42501';
  end if;

  if p_success then
    if v_recipient.consent_checked_at is null
       or coalesce(v_recipient.consent_snapshot ->> 'status', '') <> 'granted' then
      raise exception 'Current granted consent evidence is required.' using errcode = '42501';
    end if;

    update public.campaign_recipients
       set status = 'sent',
           delivery_state = 'sent',
           provider = left(nullif(btrim(coalesce(p_provider, '')), ''), 40),
           provider_message_id = left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
           sent_at = now(),
           next_attempt_at = now(),
           lease_token = null,
           lease_started_at = null,
           last_error_code = null,
           error_msg = null
     where id = p_recipient_id;
    v_state := 'sent';
    v_next_attempt := null;
  else
    v_retry := coalesce(p_retryable, false) and v_recipient.attempt_count < v_max_attempts;
    if v_retry then
      v_next_attempt := now() + case v_recipient.attempt_count
        when 1 then interval '1 minute'
        when 2 then interval '5 minutes'
        when 3 then interval '30 minutes'
        else interval '2 hours'
      end;
      update public.campaign_recipients
         set status = 'pending',
             delivery_state = 'retry',
             provider = left(nullif(btrim(coalesce(p_provider, '')), ''), 40),
             next_attempt_at = v_next_attempt,
             lease_token = null,
             lease_started_at = null,
             last_error_code = left(nullif(btrim(coalesce(p_error_code, '')), ''), 80),
             error_msg = left(coalesce(nullif(btrim(coalesce(p_error_message, '')), ''), 'Geçici sağlayıcı hatası.'), 500)
       where id = p_recipient_id;
      v_state := 'retry';
    else
      update public.campaign_recipients
         set status = 'failed',
             delivery_state = 'dead_letter',
             provider = left(nullif(btrim(coalesce(p_provider, '')), ''), 40),
             dead_lettered_at = now(),
             next_attempt_at = now(),
             lease_token = null,
             lease_started_at = null,
             last_error_code = left(coalesce(nullif(btrim(coalesce(p_error_code, '')), ''), 'provider_failure'), 80),
             error_msg = left(coalesce(nullif(btrim(coalesce(p_error_message, '')), ''), 'Teslimat kalıcı olarak başarısız.'), 500)
       where id = p_recipient_id;
      v_state := 'dead_letter';
      v_next_attempt := null;
    end if;
  end if;

  return jsonb_build_object(
    'recipient_id', p_recipient_id,
    'state', v_state,
    'attempt_count', v_recipient.attempt_count,
    'next_attempt_at', v_next_attempt
  );
end;
$$;

revoke all on function public.complete_campaign_recipient_delivery(
  uuid, uuid, uuid, uuid, uuid, boolean, text, text, text, text, boolean, integer
) from public, anon, authenticated;
grant execute on function public.complete_campaign_recipient_delivery(
  uuid, uuid, uuid, uuid, uuid, boolean, text, text, text, text, boolean, integer
) to service_role;

-- Releases only the current campaign owner. Remaining work is rescheduled for
-- a later cron tick, preventing one invocation from draining an unbounded list.
create or replace function public.finalize_campaign_delivery_batch(
  p_campaign_id uuid,
  p_tenant_id uuid,
  p_processing_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_sent integer;
  v_failed integer;
  v_remaining integer;
  v_next_due timestamptz;
  v_status public.campaign_status;
begin
  perform 1
  from public.campaigns c
  where c.id = p_campaign_id
    and c.tenant_id = p_tenant_id
    and c.status = 'sending'
    and c.processing_token = p_processing_token
  for update;

  if not found then
    raise exception 'Campaign lease ownership lost.' using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(*) filter (where r.status in ('sent', 'delivered'))::integer,
    count(*) filter (
      where r.delivery_state in ('blocked', 'skipped', 'dead_letter')
         or r.status = 'failed'
    )::integer,
    count(*) filter (
      where r.status = 'pending'
        and r.delivery_state in ('queued', 'retry', 'processing')
    )::integer,
    min(r.next_attempt_at) filter (
      where r.status = 'pending'
        and r.delivery_state in ('queued', 'retry')
    )
  into v_total, v_sent, v_failed, v_remaining, v_next_due
  from public.campaign_recipients r
  where r.campaign_id = p_campaign_id;

  if v_remaining = 0 then
    v_status := case
      when v_sent = 0 and v_failed > 0 then 'failed'::public.campaign_status
      else 'done'::public.campaign_status
    end;
    update public.campaigns
       set status = v_status,
           total_count = v_total,
           sent_count = v_sent,
           failed_count = v_failed,
           sent_at = now(),
           scheduled_at = null,
           processing_token = null,
           processing_started_at = null,
           last_error = case when v_failed > 0 then v_failed::text || ' teslimat ulaşmadı.' else null end
     where id = p_campaign_id
       and tenant_id = p_tenant_id
       and processing_token = p_processing_token;
  else
    v_status := 'scheduled'::public.campaign_status;
    update public.campaigns
       set status = 'scheduled',
           total_count = v_total,
           sent_count = v_sent,
           failed_count = v_failed,
           scheduled_at = greatest(coalesce(v_next_due, now() + interval '5 minutes'), now() + interval '30 seconds'),
           processing_token = null,
           processing_started_at = null,
           last_error = null
     where id = p_campaign_id
       and tenant_id = p_tenant_id
       and processing_token = p_processing_token;
  end if;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'status', v_status::text,
    'total', v_total,
    'sent', v_sent,
    'failed', v_failed,
    'remaining', v_remaining,
    'next_due_at', case when v_remaining > 0 then greatest(coalesce(v_next_due, now() + interval '5 minutes'), now() + interval '30 seconds') else null end
  );
end;
$$;

revoke all on function public.finalize_campaign_delivery_batch(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_campaign_delivery_batch(uuid, uuid, uuid)
  to service_role;

-- Meta delivery webhooks may arrive more than once and out of order. Resolve
-- the recipient through its campaign parent tenant, fail closed on ambiguity,
-- and apply only monotonic sent < delivered < read transitions.
create or replace function public.apply_campaign_recipient_provider_status(
  p_tenant_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_status text,
  p_occurred_at timestamptz,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_provider_message_id text := btrim(coalesce(p_provider_message_id, ''));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_occurred_at timestamptz := coalesce(p_occurred_at, clock_timestamp());
  v_recipient_ids uuid[];
  v_recipient public.campaign_recipients%rowtype;
  v_current_rank integer;
  v_target_rank integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null
     or v_provider !~ '^[a-z0-9_-]{1,40}$'
     or char_length(v_provider_message_id) < 1
     or char_length(v_provider_message_id) > 200
     or v_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'Invalid campaign provider status input.' using errcode = '22023';
  end if;

  select array_agg(r.id order by r.id)
    into v_recipient_ids
  from public.campaign_recipients r
  inner join public.campaigns c
    on c.id = r.campaign_id
   and c.tenant_id = p_tenant_id
  where r.provider = v_provider
    and r.provider_message_id = v_provider_message_id;

  if coalesce(cardinality(v_recipient_ids), 0) = 0 then
    return jsonb_build_object(
      'matched', false,
      'applied', false,
      'reason', 'recipient_not_found'
    );
  end if;
  if cardinality(v_recipient_ids) <> 1 then
    raise exception 'Ambiguous campaign provider message id.' using errcode = '21000';
  end if;

  select r.*
    into v_recipient
  from public.campaign_recipients r
  inner join public.campaigns c
    on c.id = r.campaign_id
   and c.tenant_id = p_tenant_id
  where r.id = v_recipient_ids[1]
    and r.provider = v_provider
    and r.provider_message_id = v_provider_message_id
  for update of r;

  if not found then
    raise exception 'Campaign provider status target changed.' using errcode = '40001';
  end if;

  -- Serialize counter recalculations for callbacks that target different
  -- recipients in the same campaign. The next statements receive a fresh
  -- READ COMMITTED snapshot after this parent lock is acquired.
  perform 1
  from public.campaigns c
  where c.id = v_recipient.campaign_id
    and c.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Campaign provider status parent changed.' using errcode = '40001';
  end if;

  v_current_rank := case
    when v_recipient.read_at is not null then 3
    when v_recipient.delivered_at is not null or v_recipient.status = 'delivered' then 2
    when v_recipient.sent_at is not null or v_recipient.status = 'sent' then 1
    else 0
  end;

  if v_status = 'failed' then
    -- Meta "sent" is only server acceptance; a later failed callback is still
    -- authoritative. Delivered/read are terminal successes and never regress.
    if v_current_rank >= 2 then
      return jsonb_build_object(
        'matched', true,
        'applied', false,
        'recipient_id', v_recipient.id,
        'state', v_recipient.delivery_state,
        'status', v_recipient.status::text,
        'reason', 'success_already_recorded'
      );
    end if;
    if v_recipient.delivery_state = 'dead_letter' then
      return jsonb_build_object(
        'matched', true,
        'applied', false,
        'recipient_id', v_recipient.id,
        'state', v_recipient.delivery_state,
        'status', v_recipient.status::text,
        'reason', 'duplicate'
      );
    end if;

    update public.campaign_recipients
       set status = 'failed',
           delivery_state = 'dead_letter',
           dead_lettered_at = v_occurred_at,
           lease_token = null,
           lease_started_at = null,
           last_error_code = left(coalesce(nullif(btrim(coalesce(p_error_code, '')), ''), 'provider_failed'), 80),
           error_msg = 'Mesaj sağlayıcısı teslimatın başarısız olduğunu bildirdi.'
     where id = v_recipient.id;

    -- The worker initially counts Meta server acceptance as sent. A later
    -- authoritative failed callback must move the parent metric as well.
    update public.campaigns c
       set sent_count = counts.sent_count,
           failed_count = counts.failed_count
      from (
        select
          count(*) filter (where r.status in ('sent', 'delivered'))::integer as sent_count,
          count(*) filter (
            where r.delivery_state in ('blocked', 'skipped', 'dead_letter')
               or r.status = 'failed'
          )::integer as failed_count
        from public.campaign_recipients r
        where r.campaign_id = v_recipient.campaign_id
      ) counts
     where c.id = v_recipient.campaign_id
       and c.tenant_id = p_tenant_id;

    return jsonb_build_object(
      'matched', true,
      'applied', true,
      'recipient_id', v_recipient.id,
      'state', 'dead_letter',
      'status', 'failed',
      'reason', 'provider_failed'
    );
  end if;

  v_target_rank := case v_status
    when 'sent' then 1
    when 'delivered' then 2
    when 'read' then 3
  end;
  if v_current_rank >= v_target_rank then
    return jsonb_build_object(
      'matched', true,
      'applied', false,
      'recipient_id', v_recipient.id,
      'state', v_recipient.delivery_state,
      'status', v_recipient.status::text,
      'reason', 'duplicate_or_out_of_order'
    );
  end if;

  update public.campaign_recipients
     set status = case
           when v_target_rank >= 2 then 'delivered'::public.recipient_status
           else 'sent'::public.recipient_status
         end,
         delivery_state = 'sent',
         sent_at = coalesce(sent_at, v_occurred_at),
         delivered_at = case
           when v_target_rank >= 2 then coalesce(delivered_at, v_occurred_at)
           else delivered_at
         end,
         read_at = case
           when v_target_rank >= 3 then coalesce(read_at, v_occurred_at)
           else read_at
         end,
         dead_lettered_at = null,
         lease_token = null,
         lease_started_at = null,
         last_error_code = null,
         error_msg = null
   where id = v_recipient.id;

  -- A delivered/read callback may recover an earlier out-of-order failure.
  -- Recount only after an applied transition; duplicate callbacks returned
  -- above and therefore cannot drift the counters.
  update public.campaigns c
     set sent_count = counts.sent_count,
         failed_count = counts.failed_count
    from (
      select
        count(*) filter (where r.status in ('sent', 'delivered'))::integer as sent_count,
        count(*) filter (
          where r.delivery_state in ('blocked', 'skipped', 'dead_letter')
             or r.status = 'failed'
        )::integer as failed_count
      from public.campaign_recipients r
      where r.campaign_id = v_recipient.campaign_id
    ) counts
   where c.id = v_recipient.campaign_id
     and c.tenant_id = p_tenant_id;

  return jsonb_build_object(
    'matched', true,
    'applied', true,
    'recipient_id', v_recipient.id,
    'state', 'sent',
    'status', case when v_target_rank >= 2 then 'delivered' else 'sent' end,
    'reason', v_status
  );
end;
$$;

revoke all on function public.apply_campaign_recipient_provider_status(
  uuid, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.apply_campaign_recipient_provider_status(
  uuid, text, text, text, timestamptz, text
) to service_role;

comment on column public.campaign_recipients.consent_snapshot is
  'Teslimattan hemen önce okunan yerel IYS projeksiyonu ve kanıt anlık görüntüsü; resmi IYS senkronu olduğu anlamına gelmez.';
comment on function public.verify_campaign_recipient_consent(uuid, uuid, uuid, uuid, uuid) is
  'Tenant, müşteri, kanal ve granted yerel IYS kaydını teslimattan hemen önce doğrular; eksik/ret kaydı fail-closed engeller.';
