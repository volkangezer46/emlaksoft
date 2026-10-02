-- Durable effects for public bearer-token mutations.
--
-- The state transition, immutable audit evidence and notification intent are
-- committed in one database transaction. A lease-based worker materializes the
-- in-app notification later; exact action replay repairs/requeues the same
-- deduplicated intent instead of producing duplicate side effects.

alter table public.appointments
  add column if not exists public_booking_request_key text;

create unique index if not exists idx_appointments_public_booking_request_key
  on public.appointments(public_booking_request_key)
  where public_booking_request_key is not null;

alter table public.audit_logs
  add column if not exists public_mutation_key text;

create unique index if not exists idx_audit_logs_public_mutation_key
  on public.audit_logs(tenant_id, public_mutation_key);

alter table public.notifications
  add column if not exists public_mutation_key text;

create unique index if not exists idx_profiles_id_tenant_unique
  on public.profiles(id, tenant_id);

-- MATCH SIMPLE keeps tenant-wide rows (user_id null) valid. This is
-- intentionally validated immediately: any historical cross-tenant target
-- must stop deployment and be investigated instead of being hidden.
alter table public.notifications
  add constraint notifications_user_tenant_fkey
  foreign key (user_id, tenant_id)
  references public.profiles(id, tenant_id)
  on delete cascade;

create unique index if not exists idx_notifications_public_mutation_key
  on public.notifications(tenant_id, public_mutation_key);

-- Notification creation is server-owned. Authenticated users may only read and
-- mark permitted rows read; the durable-effect idempotency namespace is also
-- service-owned. Preserve an existing key on read-state updates and reject
-- changing or mutating the trusted payload of a keyed notification.
create or replace function public.guard_notification_public_mutation_key()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    if tg_op = 'INSERT' and new.public_mutation_key is not null then
      raise exception 'Public mutation notification keys are service-owned.'
        using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' then
      if new.public_mutation_key is distinct from old.public_mutation_key then
        raise exception 'Public mutation notification keys are immutable.'
          using errcode = '42501';
      end if;
      if old.public_mutation_key is not null and (
           new.id is distinct from old.id
        or new.tenant_id is distinct from old.tenant_id
        or new.user_id is distinct from old.user_id
        or new.title is distinct from old.title
        or new.body is distinct from old.body
        or new.href is distinct from old.href
        or new.kind is distinct from old.kind
        or new.meta is distinct from old.meta
        or new.created_at is distinct from old.created_at
      ) then
        raise exception 'Public mutation notification payloads are immutable.'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_notification_public_mutation_key()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_notification_public_mutation_key
  on public.notifications;
create trigger trg_guard_notification_public_mutation_key
before insert or update on public.notifications
for each row execute function public.guard_notification_public_mutation_key();

drop policy if exists notifications_tenant_insert on public.notifications;
revoke insert on table public.notifications from authenticated;

create table if not exists public.public_mutation_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dedupe_key text not null unique check (char_length(dedupe_key) between 10 and 300),
  workflow text not null check (
    workflow in ('public_booking', 'owner_offer_response', 'appointment_confirmation')
  ),
  entity_type text not null check (entity_type in ('appointment', 'offer')),
  entity_id uuid not null,
  audit_actor_id uuid,
  audit_action text not null check (char_length(audit_action) between 1 and 120),
  audit_old_value jsonb,
  audit_new_value jsonb,
  notification_user_id uuid,
  notification_title text not null check (char_length(notification_title) between 1 and 200),
  notification_body text check (notification_body is null or char_length(notification_body) <= 1000),
  notification_href text check (notification_href is null or char_length(notification_href) <= 500),
  notification_kind text not null default 'info'
    check (notification_kind in ('info', 'success', 'warning', 'danger', 'system')),
  notification_pref_key text
    check (notification_pref_key is null or notification_pref_key in ('portal', 'appointment')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'completed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_started_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 100),
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_public_mutation_outbox_queue
  on public.public_mutation_outbox(next_attempt_at, created_at, id)
  where status in ('pending', 'retry');

create index if not exists idx_public_mutation_outbox_dead_letter
  on public.public_mutation_outbox(dead_lettered_at desc)
  where status = 'dead_letter';

alter table public.public_mutation_outbox enable row level security;
revoke all privileges on table public.public_mutation_outbox
  from public, anon, authenticated;
grant select, insert, update, delete on table public.public_mutation_outbox
  to service_role;

drop policy if exists public_mutation_outbox_service_role_only
  on public.public_mutation_outbox;
create policy public_mutation_outbox_service_role_only
  on public.public_mutation_outbox
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Upsert the durable notification intent and write the audit row immediately.
-- The unique mutation key makes both operations replay-safe.
create or replace function public.enqueue_public_mutation_effect(
  p_tenant_id uuid,
  p_dedupe_key text,
  p_workflow text,
  p_entity_type text,
  p_entity_id uuid,
  p_audit_actor_id uuid,
  p_audit_action text,
  p_audit_old_value jsonb,
  p_audit_new_value jsonb,
  p_notification_user_id uuid,
  p_notification_title text,
  p_notification_body text,
  p_notification_href text,
  p_notification_kind text,
  p_notification_pref_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null
     or p_entity_id is null
     or char_length(btrim(coalesce(p_dedupe_key, ''))) not between 10 and 300
     or p_workflow not in ('public_booking', 'owner_offer_response', 'appointment_confirmation')
     or p_entity_type not in ('appointment', 'offer')
     or char_length(btrim(coalesce(p_audit_action, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_notification_title, ''))) not between 1 and 200
     or coalesce(p_notification_kind, '') not in ('info', 'success', 'warning', 'danger', 'system')
     or (p_notification_pref_key is not null and p_notification_pref_key not in ('portal', 'appointment')) then
    raise exception 'Invalid public mutation effect.' using errcode = '22023';
  end if;

  insert into public.public_mutation_outbox (
    tenant_id,
    dedupe_key,
    workflow,
    entity_type,
    entity_id,
    audit_actor_id,
    audit_action,
    audit_old_value,
    audit_new_value,
    notification_user_id,
    notification_title,
    notification_body,
    notification_href,
    notification_kind,
    notification_pref_key,
    status,
    attempt_count,
    next_attempt_at,
    lease_token,
    lease_started_at,
    last_error_code,
    completed_at,
    dead_lettered_at,
    updated_at
  ) values (
    p_tenant_id,
    btrim(p_dedupe_key),
    p_workflow,
    p_entity_type,
    p_entity_id,
    p_audit_actor_id,
    btrim(p_audit_action),
    p_audit_old_value,
    p_audit_new_value,
    p_notification_user_id,
    btrim(p_notification_title),
    nullif(btrim(coalesce(p_notification_body, '')), ''),
    nullif(btrim(coalesce(p_notification_href, '')), ''),
    p_notification_kind,
    p_notification_pref_key,
    'pending',
    0,
    now(),
    null,
    null,
    null,
    null,
    null,
    now()
  )
  on conflict (dedupe_key) do update
     set audit_actor_id = excluded.audit_actor_id,
         audit_action = excluded.audit_action,
         audit_old_value = excluded.audit_old_value,
         audit_new_value = excluded.audit_new_value,
         notification_user_id = excluded.notification_user_id,
         notification_title = excluded.notification_title,
         notification_body = excluded.notification_body,
         notification_href = excluded.notification_href,
         notification_kind = excluded.notification_kind,
         notification_pref_key = excluded.notification_pref_key,
         status = case
           when public_mutation_outbox.status in ('completed', 'processing')
             then public_mutation_outbox.status
           else 'pending'
         end,
         attempt_count = case
           when public_mutation_outbox.status in ('completed', 'processing')
             then public_mutation_outbox.attempt_count
           else 0
         end,
         next_attempt_at = case
           when public_mutation_outbox.status in ('completed', 'processing')
             then public_mutation_outbox.next_attempt_at
           else now()
         end,
         lease_token = case
           when public_mutation_outbox.status = 'processing'
             then public_mutation_outbox.lease_token
           else null
         end,
         lease_started_at = case
           when public_mutation_outbox.status = 'processing'
             then public_mutation_outbox.lease_started_at
           else null
         end,
         last_error_code = case
           when public_mutation_outbox.status in ('completed', 'processing')
             then public_mutation_outbox.last_error_code
           else null
         end,
         completed_at = case
           when public_mutation_outbox.status = 'completed'
             then public_mutation_outbox.completed_at
           else null
         end,
         dead_lettered_at = case
           when public_mutation_outbox.status = 'completed'
             then public_mutation_outbox.dead_lettered_at
           else null
         end,
         updated_at = now()
   where public_mutation_outbox.tenant_id = excluded.tenant_id
     and public_mutation_outbox.workflow = excluded.workflow
     and public_mutation_outbox.entity_type = excluded.entity_type
     and public_mutation_outbox.entity_id = excluded.entity_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Public mutation dedupe collision.' using errcode = '23505';
  end if;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value,
    public_mutation_key
  ) values (
    p_tenant_id,
    p_audit_actor_id,
    btrim(p_audit_action),
    p_entity_type,
    p_entity_id,
    p_audit_old_value,
    p_audit_new_value,
    btrim(p_dedupe_key)
  )
  on conflict (tenant_id, public_mutation_key) do nothing;

  return v_id;
end;
$$;

revoke all on function public.enqueue_public_mutation_effect(
  uuid, text, text, text, uuid, uuid, text, jsonb, jsonb,
  uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_public_mutation_effect(
  uuid, text, text, text, uuid, uuid, text, jsonb, jsonb,
  uuid, text, text, text, text, text
) to service_role;

create or replace function public.claim_public_mutation_effects(
  p_limit integer default 50,
  p_lease_seconds integer default 300,
  p_max_attempts integer default 8
)
returns setof public.public_mutation_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100
     or p_lease_seconds < 30 or p_lease_seconds > 3600
     or p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'Invalid public mutation claim bounds.' using errcode = '22023';
  end if;

  update public.public_mutation_outbox q
     set status = case
           when q.attempt_count >= p_max_attempts then 'dead_letter'
           else 'retry'
         end,
         lease_token = null,
         lease_started_at = null,
         next_attempt_at = now(),
         dead_lettered_at = case
           when q.attempt_count >= p_max_attempts then now()
           else null
         end,
         last_error_code = 'stale_processing_lease',
         updated_at = now()
   where q.status = 'processing'
     and q.lease_started_at < now() - make_interval(secs => p_lease_seconds);

  update public.public_mutation_outbox q
     set status = 'dead_letter',
         dead_lettered_at = coalesce(q.dead_lettered_at, now()),
         last_error_code = coalesce(q.last_error_code, 'attempt_limit_reached'),
         updated_at = now()
   where q.status in ('pending', 'retry')
     and q.attempt_count >= p_max_attempts;

  return query
  with candidates as (
    select q.id
    from public.public_mutation_outbox q
    where q.status in ('pending', 'retry')
      and q.attempt_count < p_max_attempts
      and q.next_attempt_at <= now()
    order by q.next_attempt_at, q.created_at, q.id
    for update skip locked
    limit p_limit
  )
  update public.public_mutation_outbox q
     set status = 'processing',
         attempt_count = q.attempt_count + 1,
         lease_token = gen_random_uuid(),
         lease_started_at = now(),
         last_error_code = null,
         updated_at = now()
    from candidates c
   where q.id = c.id
  returning q.*;
end;
$$;

revoke all on function public.claim_public_mutation_effects(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_public_mutation_effects(integer, integer, integer)
  to service_role;

create or replace function public.complete_public_mutation_effect(
  p_id uuid,
  p_tenant_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.public_mutation_outbox%rowtype;
  v_notification public.notifications%rowtype;
  v_target_user uuid;
  v_target_valid boolean := false;
  v_should_notify boolean := true;
  v_notification_found boolean := false;
  v_notification_valid boolean := false;
  v_expected_meta jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  select q.*
    into v_job
  from public.public_mutation_outbox q
  where q.id = p_id
    and q.tenant_id = p_tenant_id
    and q.status = 'processing'
    and q.lease_token = p_lease_token
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'lease_lost');
  end if;

  -- Repair-safe: normally written during enqueue in the state transaction.
  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value,
    public_mutation_key
  ) values (
    v_job.tenant_id,
    v_job.audit_actor_id,
    v_job.audit_action,
    v_job.entity_type,
    v_job.entity_id,
    v_job.audit_old_value,
    v_job.audit_new_value,
    v_job.dedupe_key
  )
  on conflict (tenant_id, public_mutation_key) do nothing;

  if v_job.notification_user_id is not null then
    select p.id,
           case
             when v_job.notification_pref_key is null then true
             else coalesce(p.notification_prefs -> v_job.notification_pref_key, 'true'::jsonb)
                    is distinct from 'false'::jsonb
           end
      into v_target_user, v_should_notify
    from public.profiles p
    where p.id = v_job.notification_user_id
      and p.tenant_id = v_job.tenant_id
      and p.is_active = true;
    v_target_valid := found;
  end if;

  if not v_target_valid then
    -- Appointment/offer details must never broaden from one intended user to
    -- the whole office. Keep the audit, surface the missing target as an
    -- operational dead letter, and let an exact replay repair it later.
    update public.public_mutation_outbox
       set status = 'dead_letter',
           dead_lettered_at = now(),
           next_attempt_at = now(),
           lease_token = null,
           lease_started_at = null,
           last_error_code = 'notification_target_unavailable',
           updated_at = now()
     where id = v_job.id
       and tenant_id = v_job.tenant_id
       and status = 'processing'
       and lease_token = p_lease_token;
    if not found then
      raise exception 'Public mutation effect lease changed.' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'applied', false,
      'state', 'dead_letter',
      'reason', 'notification_target_unavailable'
    );
  end if;

  v_expected_meta := jsonb_build_object(
    'source', 'public_mutation_outbox',
    'workflow', v_job.workflow,
    'entity_type', v_job.entity_type,
    'entity_id', v_job.entity_id
  );

  if v_should_notify then
    insert into public.notifications (
      tenant_id,
      user_id,
      title,
      body,
      href,
      kind,
      meta,
      public_mutation_key
    ) values (
      v_job.tenant_id,
      v_target_user,
      v_job.notification_title,
      v_job.notification_body,
      v_job.notification_href,
      v_job.notification_kind,
      v_expected_meta,
      v_job.dedupe_key
    )
    on conflict (tenant_id, public_mutation_key) do nothing;
  end if;

  select n.*
    into v_notification
  from public.notifications n
  where n.tenant_id = v_job.tenant_id
    and n.public_mutation_key = v_job.dedupe_key
  for update;
  v_notification_found := found;

  if v_should_notify then
    v_notification_valid := coalesce(
      v_notification_found
      and v_notification.user_id is not distinct from v_target_user
      and v_notification.title is not distinct from v_job.notification_title
      and v_notification.body is not distinct from v_job.notification_body
      and v_notification.href is not distinct from v_job.notification_href
      and v_notification.kind is not distinct from v_job.notification_kind
      and v_notification.meta is not distinct from v_expected_meta,
      false
    );
  else
    v_notification_valid := not v_notification_found;
  end if;

  if not v_notification_valid then
    update public.public_mutation_outbox
       set status = 'dead_letter',
           dead_lettered_at = now(),
           next_attempt_at = now(),
           lease_token = null,
           lease_started_at = null,
           last_error_code = 'notification_dedupe_conflict',
           updated_at = now()
     where id = v_job.id
       and tenant_id = v_job.tenant_id
       and status = 'processing'
       and lease_token = p_lease_token;
    if not found then
      raise exception 'Public mutation effect lease changed.' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'applied', false,
      'state', 'dead_letter',
      'reason', 'notification_dedupe_conflict'
    );
  end if;

  update public.public_mutation_outbox
     set status = 'completed',
         completed_at = now(),
         next_attempt_at = now(),
         lease_token = null,
         lease_started_at = null,
         last_error_code = null,
         updated_at = now()
   where id = v_job.id
     and tenant_id = v_job.tenant_id
     and status = 'processing'
     and lease_token = p_lease_token;
  if not found then
    raise exception 'Public mutation effect lease changed.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'applied', true,
    'reason', case when v_should_notify then 'notification_materialized' else 'preference_disabled' end,
    'target_user_id', v_target_user
  );
end;
$$;

revoke all on function public.complete_public_mutation_effect(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_public_mutation_effect(uuid, uuid, uuid)
  to service_role;

create or replace function public.fail_public_mutation_effect(
  p_id uuid,
  p_tenant_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_max_attempts integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.public_mutation_outbox%rowtype;
  v_terminal boolean;
  v_next_attempt timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'Invalid public mutation attempt bound.' using errcode = '22023';
  end if;

  select q.*
    into v_job
  from public.public_mutation_outbox q
  where q.id = p_id
    and q.tenant_id = p_tenant_id
    and q.status = 'processing'
    and q.lease_token = p_lease_token
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'lease_lost');
  end if;

  v_terminal := v_job.attempt_count >= p_max_attempts;
  v_next_attempt := now() + case v_job.attempt_count
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '30 minutes'
    when 4 then interval '2 hours'
    else interval '12 hours'
  end;

  update public.public_mutation_outbox
     set status = case when v_terminal then 'dead_letter' else 'retry' end,
         next_attempt_at = v_next_attempt,
         lease_token = null,
         lease_started_at = null,
         last_error_code = left(coalesce(nullif(btrim(coalesce(p_error_code, '')), ''), 'unknown_error'), 100),
         dead_lettered_at = case when v_terminal then now() else null end,
         updated_at = now()
   where id = v_job.id
     and tenant_id = v_job.tenant_id
     and status = 'processing'
     and lease_token = p_lease_token;

  return jsonb_build_object(
    'applied', true,
    'state', case when v_terminal then 'dead_letter' else 'retry' end,
    'next_attempt_at', v_next_attempt
  );
end;
$$;

revoke all on function public.fail_public_mutation_effect(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.fail_public_mutation_effect(uuid, uuid, uuid, text, integer)
  to service_role;

-- Bound queue growth without deleting fresh failures that operations still need
-- to inspect. Audit and notification rows have their own lifecycle policies.
create or replace function public.prune_public_mutation_effects(
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 2000 then
    raise exception 'Invalid public mutation retention bound.' using errcode = '22023';
  end if;

  with candidates as (
    select q.id
    from public.public_mutation_outbox q
    where (
        q.status = 'completed'
        and q.completed_at < now() - interval '90 days'
      ) or (
        q.status = 'dead_letter'
        and q.dead_lettered_at < now() - interval '365 days'
      )
    order by coalesce(q.completed_at, q.dead_lettered_at, q.created_at), q.id
    for update skip locked
    limit p_limit
  ), deleted as (
    delete from public.public_mutation_outbox q
    using candidates c
    where q.id = c.id
    returning q.id
  )
  select count(*)::integer into v_deleted from deleted;

  return v_deleted;
end;
$$;

revoke all on function public.prune_public_mutation_effects(integer)
  from public, anon, authenticated;
grant execute on function public.prune_public_mutation_effects(integer)
  to service_role;

-- Preserve the 00970 state-transition implementations, then wrap them with
-- transaction-local audit + outbox enqueue behavior.
alter function public.create_public_booking_atomic(
  uuid, timestamptz, text, text, text, text
) rename to create_public_booking_atomic_state_v1;
alter function public.respond_owner_offer_atomic(text, uuid, text)
  rename to respond_owner_offer_atomic_state_v1;
alter function public.respond_appointment_confirmation_atomic(uuid, text)
  rename to respond_appointment_confirmation_atomic_state_v1;

revoke all on function public.create_public_booking_atomic_state_v1(
  uuid, timestamptz, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.respond_owner_offer_atomic_state_v1(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.respond_appointment_confirmation_atomic_state_v1(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.create_public_booking_atomic(
  p_public_token uuid,
  p_start_at timestamptz,
  p_full_name text,
  p_phone text,
  p_email text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_outcome text;
  v_request_key text;
  v_setting record;
  v_ids uuid[];
  v_appointment record;
  v_dedupe_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  v_result := public.create_public_booking_atomic_state_v1(
    p_public_token,
    p_start_at,
    p_full_name,
    p_phone,
    p_email,
    p_note
  );
  v_outcome := v_result ->> 'outcome';

  if v_outcome is null
     or v_outcome not in ('created', 'slot_unavailable')
     or p_public_token is null
     or p_start_at is null
     or btrim(coalesce(p_phone, '')) !~ '^05[0-9]{9}$' then
    return v_result;
  end if;

  select bs.tenant_id, bs.staff_id, bs.slot_minutes
    into v_setting
  from public.booking_settings bs
  where bs.public_token = p_public_token;
  if not found then
    raise exception 'Public booking effect source disappeared.' using errcode = '40001';
  end if;

  v_request_key := encode(
    extensions.digest(
      p_public_token::text || '|' ||
      floor(extract(epoch from p_start_at) * 1000)::bigint::text || '|' ||
      btrim(p_phone) || '|' ||
      btrim(p_full_name) || '|' ||
      lower(btrim(coalesce(p_email, ''))) || '|' ||
      btrim(coalesce(p_note, '')),
      'sha256'
    ),
    'hex'
  );

  if v_outcome = 'created' then
    -- A cancelled reservation no longer owns this submission identity; allow
    -- the customer to intentionally book the same slot again after reopening.
    update public.appointments
       set public_booking_request_key = null
     where tenant_id = v_setting.tenant_id
       and assigned_to = v_setting.staff_id
       and public_booking_request_key = v_request_key
       and status = 'cancelled';

    update public.appointments
       set public_booking_request_key = v_request_key
     where id = (v_result ->> 'appointment_id')::uuid
       and tenant_id = v_setting.tenant_id
       and assigned_to = v_setting.staff_id
       and public_booking_request_key is null;
    if not found then
      raise exception 'Public booking idempotency binding failed.' using errcode = '40001';
    end if;
  else
    select array_agg(x.id order by x.id)
      into v_ids
    from (
      select a.id
      from public.appointments a
      inner join public.customers c
        on c.id = a.customer_id
       and c.tenant_id = a.tenant_id
      where a.tenant_id = v_setting.tenant_id
        and a.status <> 'cancelled'
        and (
          a.public_booking_request_key = v_request_key
          or (
            a.public_booking_request_key is null
            and a.assigned_to = v_setting.staff_id
            and a.scheduled_at = p_start_at
            and c.phone = btrim(p_phone)
            and a.appointment_type = 'office'
            and a.notes = case
              when nullif(btrim(coalesce(p_note, '')), '') is null
                then 'Online randevu (müşteri kendisi aldı)'
              else 'Online randevu — ' || btrim(p_note)
            end
          )
        )
      order by a.id
      limit 2
    ) x;

    if coalesce(cardinality(v_ids), 0) <> 1 then
      return v_result;
    end if;
    update public.appointments
       set public_booking_request_key = coalesce(public_booking_request_key, v_request_key)
     where id = v_ids[1]
       and tenant_id = v_setting.tenant_id
       and (public_booking_request_key is null or public_booking_request_key = v_request_key);
  end if;

  select
    a.id,
    a.tenant_id,
    a.customer_id,
    a.assigned_to,
    a.scheduled_at,
    a.duration_min,
    c.full_name
  into v_appointment
  from public.appointments a
  inner join public.customers c
    on c.id = a.customer_id
   and c.tenant_id = a.tenant_id
  where a.tenant_id = v_setting.tenant_id
    and a.public_booking_request_key = v_request_key;
  if not found then
    raise exception 'Public booking effect target disappeared.' using errcode = '40001';
  end if;

  v_dedupe_key := 'public_booking:' || v_appointment.id::text;
  perform public.enqueue_public_mutation_effect(
    p_tenant_id => v_appointment.tenant_id,
    p_dedupe_key => v_dedupe_key,
    p_workflow => 'public_booking',
    p_entity_type => 'appointment',
    p_entity_id => v_appointment.id,
    p_audit_actor_id => null,
    p_audit_action => 'booking.public.create',
    p_audit_old_value => null,
    p_audit_new_value => jsonb_build_object(
      'scheduled_at', v_appointment.scheduled_at,
      'duration_min', v_appointment.duration_min,
      'customer_id', v_appointment.customer_id,
      'assigned_to', v_appointment.assigned_to,
      'source', 'online randevu'
    ),
    p_notification_user_id => v_appointment.assigned_to,
    p_notification_title => 'Online randevu: ' || left(v_appointment.full_name, 140),
    p_notification_body => to_char(
      v_appointment.scheduled_at at time zone 'Europe/Istanbul',
      'DD.MM.YYYY HH24:MI'
    ) || ' için yeni online randevu oluşturuldu.',
    p_notification_href => '/app/randevular',
    p_notification_kind => 'success',
    p_notification_pref_key => 'appointment'
  );

  return jsonb_build_object(
    'outcome', case when v_outcome = 'created' then 'created' else 'replay' end,
    'appointment_id', v_appointment.id,
    'customer_id', v_appointment.customer_id,
    'tenant_id', v_appointment.tenant_id,
    'staff_id', v_appointment.assigned_to,
    'scheduled_at', v_appointment.scheduled_at,
    'duration_min', v_appointment.duration_min
  );
end;
$$;

revoke all on function public.create_public_booking_atomic(
  uuid, timestamptz, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_atomic(
  uuid, timestamptz, text, text, text, text
) to service_role;

create or replace function public.respond_owner_offer_atomic(
  p_token text,
  p_offer_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_outcome text;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_effect record;
  v_target_user uuid;
  v_dedupe_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  v_result := public.respond_owner_offer_atomic_state_v1(p_token, p_offer_id, p_decision);
  v_outcome := v_result ->> 'outcome';
  if v_outcome = 'already_finalized'
     and (v_result ->> 'current_status') = v_decision then
    v_outcome := 'replay';
  end if;
  if v_outcome is null or v_outcome not in ('applied', 'replay') then
    return v_result;
  end if;

  select
    o.id,
    o.tenant_id,
    o.property_id,
    o.amount,
    o.created_by,
    o.status::text as decision,
    opt.owner_name,
    p.assigned_to,
    p.property_code,
    p.title
  into v_effect
  from public.owner_portal_tokens opt
  inner join public.properties p
    on p.id = opt.property_id
   and p.tenant_id = opt.tenant_id
  inner join public.offers o
    on o.id = p_offer_id
   and o.tenant_id = opt.tenant_id
   and o.property_id = opt.property_id
   and o.status::text = v_decision
  where opt.token = btrim(p_token);
  if not found then
    raise exception 'Owner offer effect source disappeared.' using errcode = '40001';
  end if;

  select pr.id
    into v_target_user
  from public.profiles pr
  where pr.tenant_id = v_effect.tenant_id
    and pr.is_active = true
    and pr.id in (v_effect.assigned_to, v_effect.created_by)
  order by case when pr.id = v_effect.assigned_to then 0 else 1 end
  limit 1;

  v_dedupe_key := 'owner_offer_response:' || v_effect.id::text || ':' || v_decision;
  perform public.enqueue_public_mutation_effect(
    p_tenant_id => v_effect.tenant_id,
    p_dedupe_key => v_dedupe_key,
    p_workflow => 'owner_offer_response',
    p_entity_type => 'offer',
    p_entity_id => v_effect.id,
    p_audit_actor_id => null,
    p_audit_action => case
      when v_decision = 'accepted' then 'offer.owner_accept'
      else 'offer.owner_reject'
    end,
    p_audit_old_value => jsonb_build_object('status', 'submitted'),
    p_audit_new_value => jsonb_build_object(
      'status', v_decision,
      'amount', v_effect.amount,
      'source', 'owner_portal',
      'owner_name', v_effect.owner_name
    ),
    p_notification_user_id => v_target_user,
    p_notification_title => case
      when v_decision = 'accepted' then 'Malik teklifi KABUL etti'
      else 'Malik teklifi reddetti'
    end,
    p_notification_body => left(
      coalesce(v_effect.title, v_effect.property_code, 'Portföy') || ' · ' ||
      to_char(v_effect.amount, 'FM999G999G999G990D00') || ' ₺',
      1000
    ),
    p_notification_href => '/app/teklifler/' || v_effect.id::text,
    p_notification_kind => case when v_decision = 'accepted' then 'success' else 'warning' end,
    p_notification_pref_key => 'portal'
  );

  return jsonb_build_object(
    'outcome', v_outcome,
    'offer_id', v_effect.id,
    'tenant_id', v_effect.tenant_id,
    'property_id', v_effect.property_id,
    'decision', v_decision
  );
end;
$$;

revoke all on function public.respond_owner_offer_atomic(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.respond_owner_offer_atomic(text, uuid, text)
  to service_role;

create or replace function public.respond_appointment_confirmation_atomic(
  p_confirm_token uuid,
  p_response text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_outcome text;
  v_response text := lower(btrim(coalesce(p_response, '')));
  v_effect record;
  v_target_user uuid;
  v_dedupe_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  v_result := public.respond_appointment_confirmation_atomic_state_v1(
    p_confirm_token,
    p_response
  );
  v_outcome := v_result ->> 'outcome';
  if v_outcome is null or v_outcome not in ('applied', 'replay') then
    return v_result;
  end if;

  select
    a.id,
    a.tenant_id,
    a.scheduled_at,
    a.status,
    a.assigned_to,
    a.customer_response,
    coalesce(c.full_name, 'Müşteri') as customer_name
  into v_effect
  from public.appointments a
  left join public.customers c
    on c.id = a.customer_id
   and c.tenant_id = a.tenant_id
  where a.confirm_token = p_confirm_token
    and a.customer_response = v_response;
  if not found then
    raise exception 'Appointment confirmation effect target disappeared.' using errcode = '40001';
  end if;

  select p.id
    into v_target_user
  from public.profiles p
  where p.id = v_effect.assigned_to
    and p.tenant_id = v_effect.tenant_id
    and p.is_active = true;

  v_dedupe_key := 'appointment_confirmation:' || v_effect.id::text || ':' || v_response;
  perform public.enqueue_public_mutation_effect(
    p_tenant_id => v_effect.tenant_id,
    p_dedupe_key => v_dedupe_key,
    p_workflow => 'appointment_confirmation',
    p_entity_type => 'appointment',
    p_entity_id => v_effect.id,
    p_audit_actor_id => null,
    p_audit_action => 'appointment.customer_response',
    p_audit_old_value => jsonb_build_object('customer_response', null),
    p_audit_new_value => jsonb_build_object(
      'customer_response', v_response,
      'status', v_effect.status,
      'source', 'confirmation_link'
    ),
    p_notification_user_id => v_target_user,
    p_notification_title => case
      when v_response = 'coming' then 'Randevu onaylandı'
      else 'Randevu iptal edildi'
    end,
    p_notification_body => left(
      v_effect.customer_name || ' · ' ||
      to_char(v_effect.scheduled_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI'),
      1000
    ),
    p_notification_href => '/app/randevular',
    p_notification_kind => case when v_response = 'coming' then 'success' else 'warning' end,
    p_notification_pref_key => 'appointment'
  );

  return jsonb_build_object(
    'outcome', v_outcome,
    'appointment_id', v_effect.id,
    'tenant_id', v_effect.tenant_id,
    'scheduled_at', v_effect.scheduled_at,
    'assigned_to', v_effect.assigned_to,
    'customer_name', v_effect.customer_name,
    'response', v_response
  );
end;
$$;

revoke all on function public.respond_appointment_confirmation_atomic(uuid, text)
  from public, anon, authenticated;
grant execute on function public.respond_appointment_confirmation_atomic(uuid, text)
  to service_role;
