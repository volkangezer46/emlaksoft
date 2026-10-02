-- Support ticket v2: strict tenant write boundary, atomic operations, persistent
-- calendar-hour SLA, operational events, internal notes and queue metrics.

-- ---------------------------------------------------------------------------
-- Canonical identifiers, assignment and persisted SLA state
-- ---------------------------------------------------------------------------

create sequence if not exists public.support_ticket_number_seq;

create or replace function public.next_support_ticket_no()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'ES-'
    || to_char(clock_timestamp() at time zone 'Europe/Istanbul', 'YYYY')
    || '-'
    || lpad(nextval('public.support_ticket_number_seq'::regclass)::text, 6, '0');
$$;

revoke all privileges on function public.next_support_ticket_no()
  from public, anon, authenticated, service_role;
grant execute on function public.next_support_ticket_no() to service_role;

alter table public.support_tickets
  add column if not exists ticket_no text,
  add column if not exists request_id uuid,
  add column if not exists created_by_staff_id uuid references public.platform_staff(id) on delete set null,
  add column if not exists source text not null default 'panel',
  add column if not exists first_response_due_at timestamptz,
  add column if not exists resolution_due_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists first_response_breached_at timestamptz,
  add column if not exists resolution_breached_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_customer_reply_at timestamptz,
  add column if not exists last_staff_reply_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopen_count integer not null default 0,
  add column if not exists resolution_code text,
  add column if not exists resolution_summary text,
  add column if not exists version bigint not null default 1;

-- Manual assignment (`assigned_staff_id`) is canonical. Keep the legacy
-- `assigned_to` column mirrored until every older consumer has been retired.
update public.support_tickets
set assigned_staff_id = assigned_to
where assigned_staff_id is null and assigned_to is not null;

create or replace function public.support_sync_canonical_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.assigned_staff_id := coalesce(new.assigned_staff_id, new.assigned_to);
    new.assigned_to := new.assigned_staff_id;
  elsif new.assigned_staff_id is distinct from old.assigned_staff_id then
    new.assigned_to := new.assigned_staff_id;
  elsif new.assigned_to is distinct from old.assigned_to then
    -- Compatibility for a short-lived legacy writer. New code only writes
    -- assigned_staff_id, and both columns leave this trigger identical.
    new.assigned_staff_id := new.assigned_to;
  else
    new.assigned_to := new.assigned_staff_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_support_sync_canonical_assignee on public.support_tickets;
create trigger trg_support_sync_canonical_assignee
before insert or update of assigned_staff_id, assigned_to
on public.support_tickets
for each row execute function public.support_sync_canonical_assignee();

create or replace function public.support_first_response_interval(p_priority text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_priority
    when 'urgent' then interval '1 hour'
    when 'high' then interval '4 hours'
    when 'low' then interval '24 hours'
    else interval '8 hours'
  end;
$$;

create or replace function public.support_resolution_interval(p_priority text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_priority
    when 'urgent' then interval '8 hours'
    when 'high' then interval '24 hours'
    when 'low' then interval '120 hours'
    else interval '72 hours'
  end;
$$;

create or replace function public.support_sla_warning_interval(p_target interval)
returns interval
language sql
immutable
set search_path = ''
as $$
  select least(p_target / 4, interval '1 hour');
$$;

comment on function public.support_first_response_interval(text) is
  'Elapsed calendar-hour first-response SLA: urgent 1h, high 4h, normal 8h, low 24h. It is not a business-hours calendar.';
comment on function public.support_resolution_interval(text) is
  'Elapsed calendar-hour resolution SLA: urgent 8h, high 24h, normal 72h, low 120h. It is not a business-hours calendar.';
comment on function public.support_sla_warning_interval(interval) is
  'SLA warning window: the smaller of 25 percent of the target or one elapsed hour.';

create or replace function public.support_set_derived_ticket_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.first_response_due_at := coalesce(
      new.first_response_due_at,
      new.created_at + public.support_first_response_interval(new.priority)
    );
    new.resolution_due_at := coalesce(
      new.resolution_due_at,
      new.created_at + public.support_resolution_interval(new.priority)
    );
    new.last_activity_at := coalesce(new.last_activity_at, new.created_at);
    new.version := greatest(coalesce(new.version, 1), 1);
  else
    if new.priority is distinct from old.priority then
      if new.first_response_at is null then
        new.first_response_due_at := coalesce(new.reopened_at, new.created_at)
          + public.support_first_response_interval(new.priority);
        new.first_response_breached_at := null;
      end if;
      if new.resolved_at is null and new.closed_at is null then
        new.resolution_due_at := coalesce(new.reopened_at, new.created_at)
          + public.support_resolution_interval(new.priority);
        new.resolution_breached_at := null;
      end if;
    end if;
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_support_set_derived_ticket_fields on public.support_tickets;
create trigger trg_support_set_derived_ticket_fields
before insert or update on public.support_tickets
for each row execute function public.support_set_derived_ticket_fields();

update public.support_tickets
set ticket_no = public.next_support_ticket_no()
where ticket_no is null;

alter table public.support_tickets
  alter column ticket_no set default public.next_support_ticket_no(),
  alter column ticket_no set not null;

update public.support_tickets t
set first_response_at = first_staff.first_at
from (
  select ticket_id, min(created_at) as first_at
  from public.support_ticket_messages
  where author_kind = 'staff'
  group by ticket_id
) first_staff
where t.id = first_staff.ticket_id and t.first_response_at is null;

update public.support_tickets t
set
  first_response_due_at = coalesce(
    t.first_response_due_at,
    t.created_at + public.support_first_response_interval(t.priority)
  ),
  resolution_due_at = coalesce(
    t.resolution_due_at,
    t.created_at + public.support_resolution_interval(t.priority)
  ),
  last_activity_at = greatest(
    coalesce(t.last_activity_at, t.created_at),
    coalesce(t.updated_at, t.created_at),
    coalesce(last_message.last_at, t.created_at)
  ),
  last_customer_reply_at = coalesce(t.last_customer_reply_at, last_message.last_tenant_at),
  last_staff_reply_at = coalesce(t.last_staff_reply_at, last_message.last_staff_at),
  closed_at = case
    when t.status = 'closed' then coalesce(t.closed_at, t.resolved_at, t.updated_at)
    else t.closed_at
  end
from (
  select
    ticket_id,
    max(created_at) as last_at,
    max(created_at) filter (where author_kind = 'tenant') as last_tenant_at,
    max(created_at) filter (where author_kind = 'staff') as last_staff_at
  from public.support_ticket_messages
  group by ticket_id
) last_message
where t.id = last_message.ticket_id;

-- Tickets without a message still need their persisted SLA targets.
update public.support_tickets
set
  first_response_due_at = coalesce(
    first_response_due_at,
    created_at + public.support_first_response_interval(priority)
  ),
  resolution_due_at = coalesce(
    resolution_due_at,
    created_at + public.support_resolution_interval(priority)
  ),
  last_activity_at = coalesce(last_activity_at, updated_at, created_at),
  closed_at = case
    when status = 'closed' then coalesce(closed_at, resolved_at, updated_at)
    else closed_at
  end;

alter table public.support_tickets
  drop constraint if exists support_tickets_category_check,
  drop constraint if exists support_tickets_subject_length_v2,
  add constraint support_tickets_subject_length_v2
    check (char_length(btrim(subject)) between 3 and 200) not valid,
  drop constraint if exists support_tickets_body_length_v2,
  add constraint support_tickets_body_length_v2
    check (char_length(btrim(body)) between 3 and 20000) not valid,
  drop constraint if exists support_tickets_category_length_v2,
  add constraint support_tickets_category_length_v2
    check (char_length(btrim(category)) between 1 and 80) not valid,
  drop constraint if exists support_tickets_source_check_v2,
  add constraint support_tickets_source_check_v2
    check (source in ('panel', 'admin', 'email', 'phone', 'api', 'whatsapp')),
  drop constraint if exists support_tickets_reopen_count_check_v2,
  add constraint support_tickets_reopen_count_check_v2 check (reopen_count >= 0),
  drop constraint if exists support_tickets_resolution_code_length_v2,
  add constraint support_tickets_resolution_code_length_v2
    check (resolution_code is null or char_length(btrim(resolution_code)) between 1 and 80),
  drop constraint if exists support_tickets_resolution_summary_length_v2,
  add constraint support_tickets_resolution_summary_length_v2
    check (resolution_summary is null or char_length(btrim(resolution_summary)) between 1 and 2000);

create unique index if not exists idx_support_tickets_ticket_no
  on public.support_tickets(ticket_no);
create unique index if not exists idx_support_tickets_request_id
  on public.support_tickets(tenant_id, created_by, request_id)
  where request_id is not null and created_by is not null;
create index if not exists idx_support_tickets_queue_v2
  on public.support_tickets(status, priority, first_response_due_at, resolution_due_at, last_activity_at desc);
create index if not exists idx_support_tickets_assignee_queue_v2
  on public.support_tickets(assigned_staff_id, status, last_activity_at desc)
  where assigned_staff_id is not null;

comment on column public.support_tickets.ticket_no is
  'Human-readable immutable support reference, for example ES-2026-000123.';
comment on column public.support_tickets.first_response_due_at is
  'Persisted first-response deadline calculated in elapsed calendar hours.';
comment on column public.support_tickets.resolution_due_at is
  'Persisted resolution deadline calculated in elapsed calendar hours.';

-- ---------------------------------------------------------------------------
-- Append-only messages, internal visibility and operational event history
-- ---------------------------------------------------------------------------

alter table public.support_ticket_messages
  add column if not exists visibility text not null default 'public',
  add column if not exists request_id uuid;

alter table public.support_ticket_messages
  drop constraint if exists support_ticket_messages_visibility_check_v2,
  add constraint support_ticket_messages_visibility_check_v2
    check (visibility in ('public', 'internal')),
  drop constraint if exists support_ticket_messages_body_length_v2,
  add constraint support_ticket_messages_body_length_v2
    check (char_length(btrim(body)) between 3 and 20000) not valid,
  drop constraint if exists support_ticket_messages_internal_author_check_v2,
  add constraint support_ticket_messages_internal_author_check_v2
    check (visibility <> 'internal' or author_kind in ('staff', 'system'));

create unique index if not exists idx_support_ticket_messages_request_id
  on public.support_ticket_messages(ticket_id, author_user_id, request_id)
  where request_id is not null and author_user_id is not null;
create index if not exists idx_support_ticket_messages_actor_v2
  on public.support_ticket_messages(ticket_id, author_kind, created_at);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid references public.support_ticket_messages(id) on delete set null,
  actor_user_id uuid,
  actor_kind text not null
    check (actor_kind in ('tenant', 'staff', 'system', 'cron')),
  event_type text not null
    check (char_length(btrim(event_type)) between 1 and 80),
  visibility text not null default 'public'
    check (visibility in ('public', 'internal')),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_ticket_events_ticket_v2
  on public.support_ticket_events(ticket_id, created_at);
create index if not exists idx_support_ticket_events_tenant_v2
  on public.support_ticket_events(tenant_id, created_at desc);

alter table public.support_ticket_events enable row level security;

create or replace function public.support_is_ticket_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_staff s
    where s.id = auth.uid()
      and s.is_active = true
      and s.role in ('super_admin', 'ops', 'support')
  );
$$;

create or replace function public.support_tenant_can_read_ticket(
  p_tenant_id uuid,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.tenant_id = p_tenant_id
      and p.is_active = true
      and public.has_effective_permission('support', 'view')
      and (
        p.role in ('owner', 'gm', 'branch_manager')
        or p_created_by = auth.uid()
      )
  );
$$;

revoke all privileges on function public.support_is_ticket_staff()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.support_tenant_can_read_ticket(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.support_is_ticket_staff() to authenticated;
grant execute on function public.support_tenant_can_read_ticket(uuid, uuid) to authenticated;

drop policy if exists support_ticket_events_tenant_select_v2 on public.support_ticket_events;
create policy support_ticket_events_tenant_select_v2
on public.support_ticket_events for select to authenticated
using (
  public.support_is_ticket_staff()
  or exists (
    select 1
    from public.support_tickets t
    where t.id = ticket_id
      and visibility = 'public'
      and public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)
  )
);

revoke all privileges on table public.support_ticket_events from public, anon, authenticated;
grant select on table public.support_ticket_events to authenticated;
grant all privileges on table public.support_ticket_events to service_role;

-- Idempotent escalation envelope. A due-date change creates a new envelope,
-- while retries for the same due date never fan out duplicate notifications.
create table if not exists public.support_ticket_sla_alerts (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  alert_kind text not null check (alert_kind in (
    'first_response_warning',
    'first_response',
    'resolution_warning',
    'resolution'
  )),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (ticket_id, alert_kind, due_at)
);

alter table public.support_ticket_sla_alerts enable row level security;
revoke all privileges on table public.support_ticket_sla_alerts
  from public, anon, authenticated;
grant all privileges on table public.support_ticket_sla_alerts to service_role;

-- Minimal one-vote CSAT contract for resolved/closed tickets.
create table if not exists public.support_ticket_csat (
  ticket_id uuid primary key references public.support_tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_support_ticket_csat_tenant_v2
  on public.support_ticket_csat(tenant_id, created_at desc);

alter table public.support_ticket_csat enable row level security;
drop policy if exists support_ticket_csat_tenant_select_v2 on public.support_ticket_csat;
create policy support_ticket_csat_tenant_select_v2
on public.support_ticket_csat for select to authenticated
using (
  public.support_is_ticket_staff()
  or exists (
    select 1
    from public.support_tickets t
    where t.id = ticket_id
      and public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)
  )
);
revoke all privileges on table public.support_ticket_csat from public, anon, authenticated;
grant select on table public.support_ticket_csat to authenticated;
grant all privileges on table public.support_ticket_csat to service_role;

-- ---------------------------------------------------------------------------
-- Strict RLS boundary: tenants can read their public support data, but all
-- writes must pass the permission-checked server actions and service-only RPCs.
-- Messages are append-only and internal notes are invisible to tenants.
-- ---------------------------------------------------------------------------

drop policy if exists tickets_tenant_all on public.support_tickets;
drop policy if exists support_tickets_tenant_select_v2 on public.support_tickets;
create policy support_tickets_tenant_select_v2
on public.support_tickets for select to authenticated
using (
  public.support_is_ticket_staff()
  or public.support_tenant_can_read_ticket(tenant_id, created_by)
);

drop policy if exists ticket_messages_access on public.support_ticket_messages;
drop policy if exists support_ticket_messages_select_v2 on public.support_ticket_messages;
create policy support_ticket_messages_select_v2
on public.support_ticket_messages for select to authenticated
using (
  exists (
    select 1
    from public.support_tickets t
    where t.id = ticket_id
      and (
        public.support_is_ticket_staff()
        or (
          visibility = 'public'
          and public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)
        )
      )
  )
);

revoke all privileges on table public.support_tickets
  from public, anon, authenticated;
revoke all privileges on table public.support_ticket_messages
  from public, anon, authenticated;
grant select on table public.support_tickets to authenticated;
grant select on table public.support_ticket_messages to authenticated;
grant all privileges on table public.support_tickets to service_role;
grant all privileges on table public.support_ticket_messages to service_role;

-- ---------------------------------------------------------------------------
-- Internal validation/event helpers. None is callable from browser roles.
-- ---------------------------------------------------------------------------

create or replace function public.support_require_service_role()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.support_actor_is_valid(
  p_actor_id uuid,
  p_actor_kind text,
  p_tenant_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_actor_kind
    when 'tenant' then exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id
        and p.tenant_id = p_tenant_id
        and p.is_active = true
    )
    when 'staff' then exists (
      select 1
      from public.platform_staff s
      where s.id = p_actor_id
        and s.is_active = true
        and s.role in ('super_admin', 'ops', 'support')
    )
    else false
  end;
$$;

create or replace function public.support_category_is_valid(
  p_tenant_id uuid,
  p_category text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.definitions d
    where d.category = 'ticket_category'
      and d.value = btrim(p_category)
      and d.is_active = true
      and (d.tenant_id is null or d.tenant_id = p_tenant_id)
  );
$$;

create or replace function public.support_transition_allowed(
  p_from text,
  p_to text,
  p_actor_kind text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = p_to then true
    when p_actor_kind = 'tenant' then case p_from
      when 'open' then p_to in ('closed')
      when 'in_progress' then p_to in ('closed')
      when 'waiting' then p_to in ('closed')
      when 'resolved' then p_to in ('open', 'closed')
      when 'closed' then p_to in ('open')
      else false
    end
    when p_actor_kind = 'staff' then case p_from
      when 'open' then p_to in ('in_progress', 'waiting', 'resolved', 'closed')
      when 'in_progress' then p_to in ('open', 'waiting', 'resolved', 'closed')
      when 'waiting' then p_to in ('open', 'in_progress', 'resolved', 'closed')
      when 'resolved' then p_to in ('open', 'waiting', 'closed')
      when 'closed' then p_to in ('open')
      else false
    end
    else false
  end;
$$;

create or replace function public.support_tenant_actor_can_access_ticket(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_actor_id
      and p.tenant_id = p_tenant_id
      and p.is_active = true
      and (
        p.role in ('owner', 'gm', 'branch_manager')
        or p_created_by = p_actor_id
      )
  );
$$;

create or replace function public.support_record_event(
  p_ticket_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_event_type text,
  p_visibility text,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_message_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_audit_old jsonb;
  v_audit_new jsonb;
begin
  insert into public.support_ticket_events (
    ticket_id,
    tenant_id,
    message_id,
    actor_user_id,
    actor_kind,
    event_type,
    visibility,
    old_value,
    new_value
  )
  values (
    p_ticket_id,
    p_tenant_id,
    p_message_id,
    p_actor_id,
    p_actor_kind,
    p_event_type,
    p_visibility,
    p_old_value,
    p_new_value
  )
  returning id into v_event_id;

  -- Audit indexes need change evidence, not customer-authored free text or file
  -- metadata. The richer value remains in the access-controlled ticket event.
  v_audit_old := case when p_old_value is null then null else
    p_old_value
      - 'resolution_summary'
      - 'body'
      - 'comment'
      - 'file_name'
      - 'files'
  end;
  v_audit_new := case when p_new_value is null then null else
    p_new_value
      - 'resolution_summary'
      - 'body'
      - 'comment'
      - 'file_name'
      - 'files'
  end;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  )
  values (
    p_tenant_id,
    p_actor_id,
    'ticket.' || p_event_type,
    'support_ticket',
    p_ticket_id,
    v_audit_old,
    v_audit_new
  );

  if p_actor_kind = 'staff' and p_actor_id is not null then
    insert into public.platform_audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      meta
    )
    values (
      p_actor_id,
      'ticket.' || p_event_type,
      'support_ticket',
      p_ticket_id,
      jsonb_build_object(
        'tenant_id', p_tenant_id,
        'visibility', p_visibility,
        'old_value', v_audit_old,
        'new_value', v_audit_new
      )
    );
  end if;

  return v_event_id;
end;
$$;

revoke all privileges on function public.support_require_service_role()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.support_actor_is_valid(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.support_category_is_valid(uuid, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.support_transition_allowed(text, text, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.support_tenant_actor_can_access_ticket(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.support_record_event(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;

create unique index if not exists idx_support_tickets_staff_request_id
  on public.support_tickets(tenant_id, created_by_staff_id, request_id)
  where request_id is not null and created_by_staff_id is not null;

-- ---------------------------------------------------------------------------
-- Atomic ticket mutations (service-role only)
-- ---------------------------------------------------------------------------

create or replace function public.create_support_ticket_v2(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_subject text,
  p_body text,
  p_category text,
  p_priority text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ticket public.support_tickets%rowtype;
  v_message_id uuid;
  v_existing public.support_tickets%rowtype;
  v_already boolean := false;
begin
  perform public.support_require_service_role();

  if p_tenant_id is null or not exists (
    select 1 from public.tenants t where t.id = p_tenant_id
  ) then
    raise exception 'Tenant not found.' using errcode = 'P0002';
  end if;
  if p_actor_kind not in ('tenant', 'staff')
    or not public.support_actor_is_valid(p_actor_id, p_actor_kind, p_tenant_id) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) not between 3 and 200 then
    raise exception 'Invalid subject.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 3 and 20000 then
    raise exception 'Invalid body.' using errcode = '22023';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if not public.support_category_is_valid(p_tenant_id, p_category) then
    raise exception 'Invalid category.' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'Request id is required.' using errcode = '22023';
  end if;

  if p_actor_kind = 'tenant' then
    select * into v_existing
    from public.support_tickets t
    where t.tenant_id = p_tenant_id
      and t.created_by = p_actor_id
      and t.request_id = p_request_id
    limit 1;
  else
    select * into v_existing
    from public.support_tickets t
    where t.tenant_id = p_tenant_id
      and t.created_by_staff_id = p_actor_id
      and t.request_id = p_request_id
    limit 1;
  end if;

  if v_existing.id is not null then
    select m.id into v_message_id
    from public.support_ticket_messages m
    where m.ticket_id = v_existing.id
      and m.author_user_id = p_actor_id
      and m.request_id = p_request_id
    order by m.created_at
    limit 1;
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'ticketId', v_existing.id,
      'ticketNo', v_existing.ticket_no,
      'messageId', v_message_id,
      'tenantId', v_existing.tenant_id,
      'createdBy', v_existing.created_by,
      'assignedStaffId', v_existing.assigned_staff_id,
      'subject', v_existing.subject,
      'status', v_existing.status
    );
  end if;

  begin
    insert into public.support_tickets (
      tenant_id,
      created_by,
      created_by_staff_id,
      subject,
      body,
      category,
      priority,
      status,
      source,
      request_id,
      first_response_at,
      last_activity_at,
      last_customer_reply_at,
      last_staff_reply_at,
      updated_at
    )
    values (
      p_tenant_id,
      case when p_actor_kind = 'tenant' then p_actor_id else null end,
      case when p_actor_kind = 'staff' then p_actor_id else null end,
      btrim(p_subject),
      btrim(p_body),
      btrim(p_category),
      p_priority,
      case when p_actor_kind = 'staff' then 'waiting' else 'open' end,
      case when p_actor_kind = 'staff' then 'admin' else 'panel' end,
      p_request_id,
      case when p_actor_kind = 'staff' then v_now else null end,
      v_now,
      case when p_actor_kind = 'tenant' then v_now else null end,
      case when p_actor_kind = 'staff' then v_now else null end,
      v_now
    )
    returning * into v_ticket;
  exception when unique_violation then
    v_already := true;
    if p_actor_kind = 'tenant' then
      select * into v_ticket
      from public.support_tickets t
      where t.tenant_id = p_tenant_id
        and t.created_by = p_actor_id
        and t.request_id = p_request_id
      limit 1;
    else
      select * into v_ticket
      from public.support_tickets t
      where t.tenant_id = p_tenant_id
        and t.created_by_staff_id = p_actor_id
        and t.request_id = p_request_id
      limit 1;
    end if;
    if v_ticket.id is null then raise; end if;
  end;

  insert into public.support_ticket_messages (
    ticket_id,
    author_user_id,
    author_kind,
    body,
    visibility,
    request_id,
    created_at
  )
  values (
    v_ticket.id,
    p_actor_id,
    p_actor_kind,
    btrim(p_body),
    'public',
    p_request_id,
    v_now
  )
  on conflict (ticket_id, author_user_id, request_id)
    where request_id is not null and author_user_id is not null
  do nothing
  returning id into v_message_id;

  if v_message_id is null then
    v_already := true;
    select m.id into v_message_id
    from public.support_ticket_messages m
    where m.ticket_id = v_ticket.id
      and m.author_user_id = p_actor_id
      and m.request_id = p_request_id
    limit 1;
  else
    perform public.support_record_event(
      v_ticket.id,
      p_tenant_id,
      p_actor_id,
      p_actor_kind,
      'create',
      'public',
      null,
      jsonb_build_object(
        'ticket_no', v_ticket.ticket_no,
        'category', v_ticket.category,
        'priority', v_ticket.priority,
        'status', v_ticket.status,
        'source', v_ticket.source,
        'body_length', char_length(btrim(p_body))
      ),
      v_message_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'already', v_already,
    'ticketId', v_ticket.id,
    'ticketNo', v_ticket.ticket_no,
    'messageId', v_message_id,
    'tenantId', v_ticket.tenant_id,
    'createdBy', v_ticket.created_by,
    'assignedStaffId', v_ticket.assigned_staff_id,
    'subject', v_ticket.subject,
    'status', v_ticket.status
  );
end;
$$;

create or replace function public.reply_support_ticket_v2(
  p_ticket_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_body text,
  p_visibility text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ticket public.support_tickets%rowtype;
  v_message_id uuid;
  v_new_status text;
  v_reopened boolean := false;
  v_old_status text;
begin
  perform public.support_require_service_role();

  if p_ticket_id is null or p_actor_id is null or p_request_id is null then
    raise exception 'Missing support identifiers.' using errcode = '22023';
  end if;
  if p_actor_kind not in ('tenant', 'staff')
    or not public.support_actor_is_valid(p_actor_id, p_actor_kind, p_tenant_id) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 3 and 20000 then
    raise exception 'Invalid body.' using errcode = '22023';
  end if;
  if p_visibility not in ('public', 'internal')
    or (p_actor_kind = 'tenant' and p_visibility <> 'public') then
    raise exception 'Invalid visibility.' using errcode = '22023';
  end if;

  select * into v_ticket
  from public.support_tickets t
  where t.id = p_ticket_id
  for update;

  if v_ticket.id is null
    or (p_actor_kind = 'tenant' and v_ticket.tenant_id is distinct from p_tenant_id) then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if p_actor_kind = 'tenant' and not public.support_tenant_actor_can_access_ticket(
    p_actor_id,
    v_ticket.tenant_id,
    v_ticket.created_by
  ) then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if p_actor_kind = 'tenant' and v_ticket.status in ('resolved', 'closed') then
    raise exception 'Ticket is not open for tenant replies.' using errcode = '22023';
  end if;
  v_old_status := v_ticket.status;
  if p_actor_kind = 'staff' and p_visibility = 'public' and v_ticket.status = 'closed' then
    raise exception 'Closed ticket cannot receive a public reply.' using errcode = '22023';
  end if;

  select m.id into v_message_id
  from public.support_ticket_messages m
  where m.ticket_id = p_ticket_id
    and m.author_user_id = p_actor_id
    and m.request_id = p_request_id
  limit 1;
  if v_message_id is not null then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'ticketId', v_ticket.id,
      'ticketNo', v_ticket.ticket_no,
      'messageId', v_message_id,
      'tenantId', v_ticket.tenant_id,
      'createdBy', v_ticket.created_by,
      'assignedStaffId', v_ticket.assigned_staff_id,
      'subject', v_ticket.subject,
      'status', v_ticket.status
    );
  end if;

  insert into public.support_ticket_messages (
    ticket_id,
    author_user_id,
    author_kind,
    body,
    visibility,
    request_id,
    created_at
  )
  values (
    p_ticket_id,
    p_actor_id,
    p_actor_kind,
    btrim(p_body),
    p_visibility,
    p_request_id,
    v_now
  )
  returning id into v_message_id;

  v_new_status := v_ticket.status;
  if p_visibility = 'public' and p_actor_kind = 'tenant' then
    v_new_status := 'in_progress';
  elsif p_visibility = 'public' and p_actor_kind = 'staff' then
    v_new_status := 'waiting';
    v_reopened := v_ticket.status = 'resolved';
  end if;

  update public.support_tickets
  set
    status = v_new_status,
    assigned_staff_id = case
      when p_actor_kind = 'staff' then coalesce(assigned_staff_id, p_actor_id)
      else assigned_staff_id
    end,
    first_response_at = case
      when p_actor_kind = 'staff' and p_visibility = 'public'
        then coalesce(first_response_at, v_now)
      else first_response_at
    end,
    first_response_breached_at = case
      when p_actor_kind = 'staff'
        and p_visibility = 'public'
        and first_response_at is null
        and first_response_due_at < v_now
        then coalesce(first_response_breached_at, v_now)
      else first_response_breached_at
    end,
    last_customer_reply_at = case
      when p_actor_kind = 'tenant' then v_now else last_customer_reply_at
    end,
    last_staff_reply_at = case
      when p_actor_kind = 'staff' and p_visibility = 'public' then v_now else last_staff_reply_at
    end,
    last_activity_at = v_now,
    resolved_at = case when v_reopened then null else resolved_at end,
    closed_at = case when v_reopened then null else closed_at end,
    resolution_code = case when v_reopened then null else resolution_code end,
    resolution_summary = case when v_reopened then null else resolution_summary end,
    reopened_at = case when v_reopened then v_now else reopened_at end,
    reopen_count = reopen_count + case when v_reopened then 1 else 0 end,
    resolution_due_at = case
      when v_reopened then v_now + public.support_resolution_interval(priority)
      else resolution_due_at
    end,
    resolution_breached_at = case when v_reopened then null else resolution_breached_at end,
    updated_at = v_now
  where id = p_ticket_id
  returning * into v_ticket;

  perform public.support_record_event(
    v_ticket.id,
    v_ticket.tenant_id,
    p_actor_id,
    p_actor_kind,
    case when p_visibility = 'internal' then 'internal_note' else 'reply' end,
    p_visibility,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object(
      'message_id', v_message_id,
      'body_length', char_length(btrim(p_body)),
      'status', v_ticket.status,
      'reopened', v_reopened
    ),
    v_message_id
  );

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'ticketId', v_ticket.id,
    'ticketNo', v_ticket.ticket_no,
    'messageId', v_message_id,
    'tenantId', v_ticket.tenant_id,
    'createdBy', v_ticket.created_by,
    'assignedStaffId', v_ticket.assigned_staff_id,
    'subject', v_ticket.subject,
    'status', v_ticket.status
  );
end;
$$;

create or replace function public.transition_support_ticket_v2(
  p_ticket_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_status text,
  p_resolution_code text default null,
  p_resolution_summary text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ticket public.support_tickets%rowtype;
  v_old_status text;
  v_reopen boolean;
begin
  perform public.support_require_service_role();

  if p_status not in ('open', 'in_progress', 'waiting', 'resolved', 'closed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  if p_actor_kind not in ('tenant', 'staff')
    or not public.support_actor_is_valid(p_actor_id, p_actor_kind, p_tenant_id) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;
  if p_resolution_code is not null
    and char_length(btrim(p_resolution_code)) not between 1 and 80 then
    raise exception 'Invalid resolution code.' using errcode = '22023';
  end if;
  if p_resolution_summary is not null
    and char_length(btrim(p_resolution_summary)) not between 1 and 2000 then
    raise exception 'Invalid resolution summary.' using errcode = '22023';
  end if;

  select * into v_ticket
  from public.support_tickets t
  where t.id = p_ticket_id
  for update;

  if v_ticket.id is null
    or (p_actor_kind = 'tenant' and v_ticket.tenant_id is distinct from p_tenant_id) then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if p_actor_kind = 'tenant' and not public.support_tenant_actor_can_access_ticket(
    p_actor_id,
    v_ticket.tenant_id,
    v_ticket.created_by
  ) then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if not public.support_transition_allowed(v_ticket.status, p_status, p_actor_kind) then
    raise exception 'Invalid ticket transition.' using errcode = '22023';
  end if;

  v_old_status := v_ticket.status;
  if v_old_status = p_status then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'ticketId', v_ticket.id,
      'ticketNo', v_ticket.ticket_no,
      'tenantId', v_ticket.tenant_id,
      'createdBy', v_ticket.created_by,
      'assignedStaffId', v_ticket.assigned_staff_id,
      'subject', v_ticket.subject,
      'status', v_ticket.status
    );
  end if;

  v_reopen := p_status = 'open' and v_old_status in ('resolved', 'closed');

  update public.support_tickets
  set
    status = p_status,
    resolved_at = case
      when p_status = 'resolved' then v_now
      when p_status = 'closed' then coalesce(resolved_at, v_now)
      when v_reopen then null
      else resolved_at
    end,
    closed_at = case
      when p_status = 'closed' then v_now
      when v_reopen then null
      else closed_at
    end,
    resolution_code = case
      when p_status in ('resolved', 'closed') then coalesce(
        nullif(btrim(p_resolution_code), ''),
        case when p_actor_kind = 'tenant' then 'closed_by_customer' else p_status end
      )
      when v_reopen then null
      else resolution_code
    end,
    resolution_summary = case
      when p_status in ('resolved', 'closed') then nullif(btrim(p_resolution_summary), '')
      when v_reopen then null
      else resolution_summary
    end,
    reopened_at = case when v_reopen then v_now else reopened_at end,
    reopen_count = reopen_count + case when v_reopen then 1 else 0 end,
    first_response_due_at = case
      when v_reopen and first_response_at is null
        then v_now + public.support_first_response_interval(priority)
      else first_response_due_at
    end,
    first_response_breached_at = case
      when v_reopen and first_response_at is null then null
      else first_response_breached_at
    end,
    resolution_due_at = case
      when v_reopen then v_now + public.support_resolution_interval(priority)
      else resolution_due_at
    end,
    resolution_breached_at = case when v_reopen then null else resolution_breached_at end,
    last_activity_at = v_now,
    updated_at = v_now
  where id = p_ticket_id
  returning * into v_ticket;

  perform public.support_record_event(
    v_ticket.id,
    v_ticket.tenant_id,
    p_actor_id,
    p_actor_kind,
    'status',
    'public',
    jsonb_build_object('status', v_old_status),
    jsonb_strip_nulls(jsonb_build_object(
      'status', v_ticket.status,
      'resolution_code', v_ticket.resolution_code,
      'resolution_summary', v_ticket.resolution_summary,
      'reopened', v_reopen
    ))
  );

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'ticketId', v_ticket.id,
    'ticketNo', v_ticket.ticket_no,
    'tenantId', v_ticket.tenant_id,
    'createdBy', v_ticket.created_by,
    'assignedStaffId', v_ticket.assigned_staff_id,
    'subject', v_ticket.subject,
    'status', v_ticket.status,
    'oldStatus', v_old_status
  );
end;
$$;

create or replace function public.admin_update_support_ticket_v2(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_field text,
  p_value text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ticket public.support_tickets%rowtype;
  v_old_value text;
  v_assignee uuid;
begin
  perform public.support_require_service_role();
  if not public.support_actor_is_valid(p_actor_id, 'staff', null) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;
  if p_field not in ('priority', 'category', 'assigned_staff_id') then
    raise exception 'Invalid admin ticket field.' using errcode = '22023';
  end if;

  select * into v_ticket
  from public.support_tickets t
  where t.id = p_ticket_id
  for update;
  if v_ticket.id is null then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if p_field = 'priority' then
    if p_value not in ('low', 'normal', 'high', 'urgent') then
      raise exception 'Invalid priority.' using errcode = '22023';
    end if;
    v_old_value := v_ticket.priority;
    update public.support_tickets
    set priority = p_value, last_activity_at = v_now, updated_at = v_now
    where id = p_ticket_id
    returning * into v_ticket;
  elsif p_field = 'category' then
    if not public.support_category_is_valid(v_ticket.tenant_id, p_value) then
      raise exception 'Invalid category.' using errcode = '22023';
    end if;
    v_old_value := v_ticket.category;
    update public.support_tickets
    set category = btrim(p_value), last_activity_at = v_now, updated_at = v_now
    where id = p_ticket_id
    returning * into v_ticket;
  else
    v_old_value := coalesce(v_ticket.assigned_staff_id::text, '');
    if nullif(btrim(coalesce(p_value, '')), '') is not null then
      begin
        v_assignee := btrim(p_value)::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid assignee.' using errcode = '22023';
      end;
      if not public.support_actor_is_valid(v_assignee, 'staff', null) then
        raise exception 'Invalid assignee.' using errcode = '22023';
      end if;
    else
      v_assignee := null;
    end if;
    update public.support_tickets
    set assigned_staff_id = v_assignee, last_activity_at = v_now, updated_at = v_now
    where id = p_ticket_id
    returning * into v_ticket;
  end if;

  if v_old_value is distinct from coalesce(
    case p_field
      when 'priority' then v_ticket.priority
      when 'category' then v_ticket.category
      else v_ticket.assigned_staff_id::text
    end,
    ''
  ) then
    perform public.support_record_event(
      v_ticket.id,
      v_ticket.tenant_id,
      p_actor_id,
      'staff',
      case when p_field = 'assigned_staff_id' then 'assign' else p_field end,
      'public',
      jsonb_build_object(p_field, nullif(v_old_value, '')),
      jsonb_build_object(
        p_field,
        case p_field
          when 'priority' then v_ticket.priority
          when 'category' then v_ticket.category
          else v_ticket.assigned_staff_id::text
        end
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticketId', v_ticket.id,
    'ticketNo', v_ticket.ticket_no,
    'tenantId', v_ticket.tenant_id,
    'createdBy', v_ticket.created_by,
    'assignedStaffId', v_ticket.assigned_staff_id,
    'subject', v_ticket.subject,
    'status', v_ticket.status,
    'priority', v_ticket.priority,
    'category', v_ticket.category
  );
end;
$$;

create or replace function public.bulk_update_support_tickets_v2(
  p_ticket_ids uuid[],
  p_actor_id uuid,
  p_field text,
  p_value text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  perform public.support_require_service_role();
  if not public.support_actor_is_valid(p_actor_id, 'staff', null) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ticket_ids, 1), 0) not between 1 and 50 then
    raise exception 'Bulk ticket count must be between 1 and 50.' using errcode = '22023';
  end if;
  if p_field not in ('status', 'priority', 'category', 'assigned_staff_id') then
    raise exception 'Invalid bulk field.' using errcode = '22023';
  end if;

  foreach v_id in array p_ticket_ids loop
    if p_field = 'status' then
      perform public.transition_support_ticket_v2(
        v_id,
        null,
        p_actor_id,
        'staff',
        p_value,
        case when p_value in ('resolved', 'closed') then 'bulk_update' else null end,
        null
      );
    else
      perform public.admin_update_support_ticket_v2(v_id, p_actor_id, p_field, p_value);
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

create or replace function public.submit_support_ticket_csat_v2(
  p_ticket_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid,
  p_score integer,
  p_comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_inserted integer := 0;
begin
  perform public.support_require_service_role();
  if not public.support_actor_is_valid(p_actor_id, 'tenant', p_tenant_id) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;
  if p_score not between 1 and 5 then
    raise exception 'Invalid CSAT score.' using errcode = '22023';
  end if;
  if p_comment is not null and char_length(p_comment) > 1000 then
    raise exception 'Invalid CSAT comment.' using errcode = '22023';
  end if;

  select * into v_ticket
  from public.support_tickets t
  where t.id = p_ticket_id and t.tenant_id = p_tenant_id
  for update;
  if v_ticket.id is null then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if not public.support_tenant_actor_can_access_ticket(
    p_actor_id,
    v_ticket.tenant_id,
    v_ticket.created_by
  ) then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if v_ticket.status not in ('resolved', 'closed') then
    raise exception 'CSAT requires a resolved ticket.' using errcode = '22023';
  end if;
  insert into public.support_ticket_csat (
    ticket_id,
    tenant_id,
    submitted_by,
    score,
    comment
  )
  values (
    p_ticket_id,
    p_tenant_id,
    p_actor_id,
    p_score,
    nullif(btrim(p_comment), '')
  )
  on conflict (ticket_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('ok', true, 'already', true, 'ticketId', p_ticket_id);
  end if;

  perform public.support_record_event(
    v_ticket.id,
    v_ticket.tenant_id,
    p_actor_id,
    'tenant',
    'csat',
    'internal',
    null,
    jsonb_build_object('score', p_score, 'has_comment', nullif(btrim(p_comment), '') is not null)
  );

  return jsonb_build_object('ok', true, 'already', false, 'ticketId', p_ticket_id);
end;
$$;

create or replace function public.process_support_ticket_sla_escalations_v2(
  p_limit integer default 200
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ticket public.support_tickets%rowtype;
  v_alert_id uuid;
  v_first_warning_count integer := 0;
  v_first_count integer := 0;
  v_resolution_warning_count integer := 0;
  v_resolution_count integer := 0;
  v_title text;
  v_body text;
begin
  perform public.support_require_service_role();
  if p_limit not between 1 and 500 then
    raise exception 'Invalid SLA batch size.' using errcode = '22023';
  end if;

  for v_ticket in
    select t.*
    from public.support_tickets t
    where t.status in ('open', 'in_progress', 'waiting')
      and t.first_response_at is null
      and t.first_response_due_at >= v_now
      and t.first_response_due_at <= v_now + public.support_sla_warning_interval(
        public.support_first_response_interval(t.priority)
      )
    order by t.first_response_due_at
    limit p_limit
    for update skip locked
  loop
    v_alert_id := null;
    insert into public.support_ticket_sla_alerts(ticket_id, alert_kind, due_at)
    values (v_ticket.id, 'first_response_warning', v_ticket.first_response_due_at)
    on conflict (ticket_id, alert_kind, due_at) do nothing
    returning id into v_alert_id;
    if v_alert_id is null then continue; end if;

    perform public.support_record_event(
      v_ticket.id,
      v_ticket.tenant_id,
      null,
      'cron',
      'sla_first_response_warning',
      'internal',
      null,
      jsonb_build_object('due_at', v_ticket.first_response_due_at, 'ticket_no', v_ticket.ticket_no)
    );

    v_title := 'İlk yanıt SLA süresi yaklaşıyor · ' || v_ticket.ticket_no;
    v_body := v_ticket.subject;
    if v_ticket.assigned_staff_id is not null and exists (
      select 1 from public.platform_staff s
      where s.id = v_ticket.assigned_staff_id
        and s.is_active = true
        and s.role in ('super_admin', 'ops', 'support')
    ) then
      insert into public.platform_notifications(staff_id, title, body, href, kind, meta)
      values (
        v_ticket.assigned_staff_id,
        v_title,
        v_body,
        '/admin/tickets/' || v_ticket.id,
        'warning',
        jsonb_build_object(
          'ticket_id', v_ticket.id,
          'ticket_no', v_ticket.ticket_no,
          'sla', 'first_response_warning'
        )
      );
    else
      insert into public.platform_notifications(staff_id, title, body, href, kind, meta)
      select
        s.id,
        v_title,
        v_body,
        '/admin/tickets/' || v_ticket.id,
        'warning',
        jsonb_build_object(
          'ticket_id', v_ticket.id,
          'ticket_no', v_ticket.ticket_no,
          'sla', 'first_response_warning'
        )
      from public.platform_staff s
      where s.is_active = true and s.role in ('super_admin', 'ops', 'support');
    end if;
    v_first_warning_count := v_first_warning_count + 1;
  end loop;

  for v_ticket in
    select t.*
    from public.support_tickets t
    where t.status in ('open', 'in_progress', 'waiting')
      and t.first_response_at is null
      and t.first_response_due_at < v_now
    order by t.first_response_due_at
    limit p_limit
    for update skip locked
  loop
    v_alert_id := null;
    insert into public.support_ticket_sla_alerts(ticket_id, alert_kind, due_at)
    values (v_ticket.id, 'first_response', v_ticket.first_response_due_at)
    on conflict (ticket_id, alert_kind, due_at) do nothing
    returning id into v_alert_id;
    if v_alert_id is null then continue; end if;

    update public.support_tickets
    set first_response_breached_at = coalesce(first_response_breached_at, v_now),
        updated_at = v_now
    where id = v_ticket.id;

    perform public.support_record_event(
      v_ticket.id,
      v_ticket.tenant_id,
      null,
      'cron',
      'sla_first_response_breach',
      'internal',
      null,
      jsonb_build_object('due_at', v_ticket.first_response_due_at, 'ticket_no', v_ticket.ticket_no)
    );

    v_title := 'İlk yanıt SLA ihlali · ' || v_ticket.ticket_no;
    v_body := v_ticket.subject;
    if v_ticket.assigned_staff_id is not null and exists (
      select 1 from public.platform_staff s
      where s.id = v_ticket.assigned_staff_id
        and s.is_active = true
        and s.role in ('super_admin', 'ops', 'support')
    ) then
      insert into public.platform_notifications(staff_id, title, body, href, kind, meta)
      values (
        v_ticket.assigned_staff_id,
        v_title,
        v_body,
        '/admin/tickets/' || v_ticket.id,
        'danger',
        jsonb_build_object('ticket_id', v_ticket.id, 'ticket_no', v_ticket.ticket_no, 'sla', 'first_response')
      );
    else
      insert into public.platform_notifications(staff_id, title, body, href, kind, meta)
      select
        s.id,
        v_title,
        v_body,
        '/admin/tickets/' || v_ticket.id,
        'danger',
        jsonb_build_object('ticket_id', v_ticket.id, 'ticket_no', v_ticket.ticket_no, 'sla', 'first_response')
      from public.platform_staff s
      where s.is_active = true and s.role in ('super_admin', 'ops', 'support');
    end if;
    v_first_count := v_first_count + 1;
  end loop;

  for v_ticket in
    select t.*
    from public.support_tickets t
    where t.status in ('open', 'in_progress', 'waiting')
      and t.resolution_due_at >= v_now
      and t.resolution_due_at <= v_now + public.support_sla_warning_interval(
        public.support_resolution_interval(t.priority)
      )
    order by t.resolution_due_at
    limit p_limit
    for update skip locked
  loop
    v_alert_id := null;
    insert into public.support_ticket_sla_alerts(ticket_id, alert_kind, due_at)
    values (v_ticket.id, 'resolution_warning', v_ticket.resolution_due_at)
    on conflict (ticket_id, alert_kind, due_at) do nothing
    returning id into v_alert_id;
    if v_alert_id is null then continue; end if;

    perform public.support_record_event(
      v_ticket.id,
      v_ticket.tenant_id,
      null,
      'cron',
      'sla_resolution_warning',
      'internal',
      null,
      jsonb_build_object('due_at', v_ticket.resolution_due_at, 'ticket_no', v_ticket.ticket_no)
    );

    v_title := 'Çözüm SLA süresi yaklaşıyor · ' || v_ticket.ticket_no;
    v_body := v_ticket.subject;
    if v_ticket.assigned_staff_id is not null and exists (
      select 1 from public.platform_staff s
      where s.id = v_ticket.assigned_staff_id
        and s.is_active = true
        and s.role in ('super_admin', 'ops', 'support')
    ) then
      insert into public.platform_notifications(staff_id, title, body, href, kind, meta)
      values (
        v_ticket.assigned_staff_id,
        v_title,
        v_body,
        '/admin/tickets/' || v_ticket.id,
        'warning',
        jsonb_build_object(
          'ticket_id', v_ticket.id,
          'ticket_no', v_ticket.ticket_no,
          'sla', 'resolution_warning'
        )
      );
    else
      insert into public.platform_notifications(staff_id, title, body, href, kind, meta)
      select
        s.id,
        v_title,
        v_body,
        '/admin/tickets/' || v_ticket.id,
        'warning',
        jsonb_build_object(
          'ticket_id', v_ticket.id,
          'ticket_no', v_ticket.ticket_no,
          'sla', 'resolution_warning'
        )
      from public.platform_staff s
      where s.is_active = true and s.role in ('super_admin', 'ops', 'support');
    end if;
    v_resolution_warning_count := v_resolution_warning_count + 1;
  end loop;

  for v_ticket in
    select t.*
    from public.support_tickets t
    where t.status in ('open', 'in_progress', 'waiting')
      and t.resolution_due_at < v_now
    order by t.resolution_due_at
    limit p_limit
    for update skip locked
  loop
    v_alert_id := null;
    insert into public.support_ticket_sla_alerts(ticket_id, alert_kind, due_at)
    values (v_ticket.id, 'resolution', v_ticket.resolution_due_at)
    on conflict (ticket_id, alert_kind, due_at) do nothing
    returning id into v_alert_id;
    if v_alert_id is null then continue; end if;

    update public.support_tickets
    set resolution_breached_at = coalesce(resolution_breached_at, v_now),
        updated_at = v_now
    where id = v_ticket.id;

    perform public.support_record_event(
      v_ticket.id,
      v_ticket.tenant_id,
      null,
      'cron',
      'sla_resolution_breach',
      'internal',
      null,
      jsonb_build_object('due_at', v_ticket.resolution_due_at, 'ticket_no', v_ticket.ticket_no)
    );

    v_title := 'Çözüm SLA ihlali · ' || v_ticket.ticket_no;
    v_body := v_ticket.subject;
    if v_ticket.assigned_staff_id is not null and exists (
      select 1 from public.platform_staff s
      where s.id = v_ticket.assigned_staff_id
        and s.is_active = true
        and s.role in ('super_admin', 'ops', 'support')
    ) then
      insert into public.platform_notifications(staff_id, title, body, href, kind, meta)
      values (
        v_ticket.assigned_staff_id,
        v_title,
        v_body,
        '/admin/tickets/' || v_ticket.id,
        'danger',
        jsonb_build_object('ticket_id', v_ticket.id, 'ticket_no', v_ticket.ticket_no, 'sla', 'resolution')
      );
    else
      insert into public.platform_notifications(staff_id, title, body, href, kind, meta)
      select
        s.id,
        v_title,
        v_body,
        '/admin/tickets/' || v_ticket.id,
        'danger',
        jsonb_build_object('ticket_id', v_ticket.id, 'ticket_no', v_ticket.ticket_no, 'sla', 'resolution')
      from public.platform_staff s
      where s.is_active = true and s.role in ('super_admin', 'ops', 'support');
    end if;
    v_resolution_count := v_resolution_count + 1;
  end loop;

  return jsonb_build_object(
    'firstResponseWarnings', v_first_warning_count,
    'firstResponseEscalated', v_first_count,
    'resolutionWarnings', v_resolution_warning_count,
    'resolutionEscalated', v_resolution_count,
    'processedAt', v_now
  );
end;
$$;

create or replace function public.support_ticket_metrics_v2(
  p_tenant_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.support_require_service_role();
  with scoped as (
    select *
    from public.support_tickets t
    where p_tenant_id is null or t.tenant_id = p_tenant_id
  ),
  aggregate_metrics as (
    select
      count(*)::integer as total,
      count(*) filter (where status in ('open', 'in_progress', 'waiting'))::integer as open_count,
      count(*) filter (
        where priority = 'urgent' and status in ('open', 'in_progress', 'waiting')
      )::integer as urgent_count,
      count(*) filter (where status in ('resolved', 'closed'))::integer as resolved_count,
      count(*) filter (
        where status in ('open', 'in_progress', 'waiting')
          and first_response_breached_at is not null
      )::integer as first_response_breached,
      count(*) filter (
        where status in ('open', 'in_progress', 'waiting')
          and resolution_breached_at is not null
      )::integer as resolution_breached,
      avg(extract(epoch from (resolved_at - created_at)))
        filter (where resolved_at is not null and resolved_at >= created_at) as avg_resolution_seconds
    from scoped
  ),
  status_counts as (
    select coalesce(jsonb_object_agg(status, count_value), '{}'::jsonb) as value
    from (
      select status, count(*)::integer as count_value
      from scoped group by status
    ) counts
  ),
  priority_counts as (
    select coalesce(jsonb_object_agg(priority, count_value), '{}'::jsonb) as value
    from (
      select priority, count(*)::integer as count_value
      from scoped group by priority
    ) counts
  ),
  category_counts as (
    select coalesce(jsonb_object_agg(category, count_value), '{}'::jsonb) as value
    from (
      select category, count(*)::integer as count_value
      from scoped group by category
    ) counts
  ),
  days as (
    select generate_series(
      (((now() at time zone 'Europe/Istanbul')::date - 13)::timestamp),
      ((now() at time zone 'Europe/Istanbul')::date::timestamp),
      interval '1 day'
    )::date as day
  ),
  daily as (
    select
      d.day,
      count(s.id)::integer as count_value
    from days d
    left join scoped s
      on (s.created_at at time zone 'Europe/Istanbul')::date = d.day
    group by d.day
    order by d.day
  ),
  daily_json as (
    select coalesce(
      jsonb_agg(jsonb_build_object('date', day, 'value', count_value) order by day),
      '[]'::jsonb
    ) as value
    from daily
  )
  select jsonb_build_object(
    'total', a.total,
    'open', a.open_count,
    'urgent', a.urgent_count,
    'resolved', a.resolved_count,
    'resolutionRate', case when a.total = 0 then 0 else round(a.resolved_count * 100.0 / a.total) end,
    'avgResolutionSeconds', a.avg_resolution_seconds,
    'firstResponseBreached', a.first_response_breached,
    'resolutionBreached', a.resolution_breached,
    'statusCounts', s.value,
    'priorityCounts', p.value,
    'categoryCounts', c.value,
    'last14Days', d.value,
    'slaPolicy', 'elapsed_calendar_hours'
  )
  into v_result
  from aggregate_metrics a
  cross join status_counts s
  cross join priority_counts p
  cross join category_counts c
  cross join daily_json d;
  return v_result;
end;
$$;

create or replace function public.support_ticket_queue_v2(
  p_status text default null,
  p_priority text default null,
  p_tenant_id uuid default null,
  p_assigned_staff_id uuid default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_category text default null,
  p_unassigned boolean default false,
  p_sla text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_items jsonb;
  v_search text := nullif(btrim(p_search), '');
begin
  perform public.support_require_service_role();
  if p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'Invalid queue pagination.' using errcode = '22023';
  end if;
  if p_status is not null
    and p_status not in ('acik', 'cozulmus', 'open', 'in_progress', 'waiting', 'resolved', 'closed') then
    raise exception 'Invalid queue status.' using errcode = '22023';
  end if;
  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid queue priority.' using errcode = '22023';
  end if;
  if p_category is not null and char_length(btrim(p_category)) not between 1 and 80 then
    raise exception 'Invalid queue category.' using errcode = '22023';
  end if;
  if p_sla is not null and p_sla not in ('normal', 'warning', 'breached') then
    raise exception 'Invalid queue SLA filter.' using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 120 then
    raise exception 'Invalid queue search.' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.support_tickets t
  join public.tenants tenant on tenant.id = t.tenant_id
  where (p_tenant_id is null or t.tenant_id = p_tenant_id)
    and (
      (coalesce(p_unassigned, false) and t.assigned_staff_id is null)
      or (
        not coalesce(p_unassigned, false)
        and (p_assigned_staff_id is null or t.assigned_staff_id = p_assigned_staff_id)
      )
    )
    and (
      p_status is null
      or (p_status = 'acik' and t.status in ('open', 'in_progress', 'waiting'))
      or (p_status = 'cozulmus' and t.status in ('resolved', 'closed'))
      or (p_status not in ('acik', 'cozulmus') and t.status = p_status)
    )
    and (p_priority is null or t.priority = p_priority)
    and (p_category is null or t.category = p_category)
    and (
      p_sla is null
      or (
        p_sla = 'breached'
        and t.status in ('open', 'in_progress', 'waiting')
        and (
          (t.first_response_at is null and t.first_response_due_at < now())
          or t.resolution_due_at < now()
        )
      )
      or (
        p_sla = 'warning'
        and t.status in ('open', 'in_progress', 'waiting')
        and not (
          (t.first_response_at is null and t.first_response_due_at < now())
          or t.resolution_due_at < now()
        )
        and case
          when t.first_response_at is null then t.first_response_due_at
          else t.resolution_due_at
        end <= now() + case
          when t.first_response_at is null then public.support_sla_warning_interval(
            public.support_first_response_interval(t.priority)
          )
          else public.support_sla_warning_interval(
            public.support_resolution_interval(t.priority)
          )
        end
      )
      or (
        p_sla = 'normal'
        and t.status in ('open', 'in_progress', 'waiting')
        and not (
          (
            t.first_response_at is null
            and t.first_response_due_at <= now() + public.support_sla_warning_interval(
              public.support_first_response_interval(t.priority)
            )
          )
          or (
            t.first_response_at is not null
            and t.resolution_due_at <= now() + public.support_sla_warning_interval(
              public.support_resolution_interval(t.priority)
            )
          )
        )
      )
    )
    and (
      v_search is null
      or position(lower(v_search) in lower(t.ticket_no)) > 0
      or position(lower(v_search) in lower(t.subject)) > 0
      or position(lower(v_search) in lower(tenant.name)) > 0
    );

  select coalesce(
    jsonb_agg(
      to_jsonb(q) - 'queue_rank' - 'queue_due_at'
      order by q.queue_rank, q.queue_due_at nulls last, q.last_activity_at desc, q.id
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      t.id,
      t.ticket_no,
      t.subject,
      t.body,
      t.category,
      t.priority,
      t.status,
      t.source,
      t.tenant_id,
      tenant.name as tenant_name,
      t.created_by,
      requester.full_name as requester_name,
      t.assigned_staff_id,
      assignee.full_name as assigned_staff_name,
      t.created_at,
      t.updated_at,
      t.last_activity_at,
      t.first_response_due_at,
      t.resolution_due_at,
      t.first_response_at,
      t.first_response_breached_at,
      t.resolution_breached_at,
      coalesce(message_stats.message_count, 0)::integer as message_count,
      case
        when t.status in ('open', 'in_progress', 'waiting')
          and t.first_response_at is null
          and t.first_response_due_at < now() then 0
        when t.status in ('open', 'in_progress', 'waiting')
          and t.resolution_due_at < now() then 1
        when t.priority = 'urgent'
          and t.status in ('open', 'in_progress', 'waiting') then 2
        when t.status in ('open', 'in_progress', 'waiting') then 3
        else 4
      end as queue_rank,
      case
        when t.first_response_at is null then t.first_response_due_at
        else t.resolution_due_at
      end as queue_due_at
    from public.support_tickets t
    join public.tenants tenant on tenant.id = t.tenant_id
    left join public.profiles requester on requester.id = t.created_by
    left join public.platform_staff assignee on assignee.id = t.assigned_staff_id
    left join lateral (
      select count(*)::bigint as message_count
      from public.support_ticket_messages m
      where m.ticket_id = t.id
    ) message_stats on true
    where (p_tenant_id is null or t.tenant_id = p_tenant_id)
      and (
        (coalesce(p_unassigned, false) and t.assigned_staff_id is null)
        or (
          not coalesce(p_unassigned, false)
          and (p_assigned_staff_id is null or t.assigned_staff_id = p_assigned_staff_id)
        )
      )
      and (
        p_status is null
        or (p_status = 'acik' and t.status in ('open', 'in_progress', 'waiting'))
        or (p_status = 'cozulmus' and t.status in ('resolved', 'closed'))
        or (p_status not in ('acik', 'cozulmus') and t.status = p_status)
      )
      and (p_priority is null or t.priority = p_priority)
      and (p_category is null or t.category = p_category)
      and (
        p_sla is null
        or (
          p_sla = 'breached'
          and t.status in ('open', 'in_progress', 'waiting')
          and (
            (t.first_response_at is null and t.first_response_due_at < now())
            or t.resolution_due_at < now()
          )
        )
        or (
          p_sla = 'warning'
          and t.status in ('open', 'in_progress', 'waiting')
          and not (
            (t.first_response_at is null and t.first_response_due_at < now())
            or t.resolution_due_at < now()
          )
          and case
            when t.first_response_at is null then t.first_response_due_at
            else t.resolution_due_at
          end <= now() + case
            when t.first_response_at is null then public.support_sla_warning_interval(
              public.support_first_response_interval(t.priority)
            )
            else public.support_sla_warning_interval(
              public.support_resolution_interval(t.priority)
            )
          end
        )
        or (
          p_sla = 'normal'
          and t.status in ('open', 'in_progress', 'waiting')
          and not (
            (
              t.first_response_at is null
              and t.first_response_due_at <= now() + public.support_sla_warning_interval(
                public.support_first_response_interval(t.priority)
              )
            )
            or (
              t.first_response_at is not null
              and t.resolution_due_at <= now() + public.support_sla_warning_interval(
                public.support_resolution_interval(t.priority)
              )
            )
          )
        )
      )
      and (
        v_search is null
        or position(lower(v_search) in lower(t.ticket_no)) > 0
        or position(lower(v_search) in lower(t.subject)) > 0
        or position(lower(v_search) in lower(tenant.name)) > 0
      )
    order by queue_rank, queue_due_at nulls last, t.last_activity_at desc, t.id
    limit p_limit offset p_offset
  ) q;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'slaPolicy', 'elapsed_calendar_hours'
  );
end;
$$;

-- Public RPC exposure is intentionally denied. Server actions authenticate,
-- authorize and derive tenant/actor identity before using the service client.
revoke all privileges on function public.create_support_ticket_v2(
  uuid, uuid, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all privileges on function public.reply_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all privileges on function public.transition_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all privileges on function public.admin_update_support_ticket_v2(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all privileges on function public.bulk_update_support_tickets_v2(
  uuid[], uuid, text, text
) from public, anon, authenticated, service_role;
revoke all privileges on function public.submit_support_ticket_csat_v2(
  uuid, uuid, uuid, integer, text
) from public, anon, authenticated, service_role;
revoke all privileges on function public.process_support_ticket_sla_escalations_v2(integer)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.support_ticket_metrics_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.support_ticket_queue_v2(
  text, text, uuid, uuid, text, integer, integer, text, boolean, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_support_ticket_v2(
  uuid, uuid, text, text, text, text, text, uuid
) to service_role;
grant execute on function public.reply_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, uuid
) to service_role;
grant execute on function public.transition_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, text
) to service_role;
grant execute on function public.admin_update_support_ticket_v2(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.bulk_update_support_tickets_v2(
  uuid[], uuid, text, text
) to service_role;
grant execute on function public.submit_support_ticket_csat_v2(
  uuid, uuid, uuid, integer, text
) to service_role;
grant execute on function public.process_support_ticket_sla_escalations_v2(integer)
  to service_role;
grant execute on function public.support_ticket_metrics_v2(uuid)
  to service_role;
grant execute on function public.support_ticket_queue_v2(
  text, text, uuid, uuid, text, integer, integer, text, boolean, text
) to service_role;

notify pgrst, 'reload schema';
