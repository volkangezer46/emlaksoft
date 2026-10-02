-- Security boundaries and support lifecycle integrity.
-- Forward-only: historical migrations remain immutable.

-- ---------------------------------------------------------------------------
-- Tenant role claims
-- ---------------------------------------------------------------------------

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.role
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id::text = nullif(
          btrim(auth.jwt() -> 'app_metadata' ->> 'tenant_id'),
          ''
        )
        and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')
      limit 1
    ),
    case
      when auth.jwt() -> 'app_metadata' ->> 'impersonating' = 'true'
        and auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'
        and exists (
          select 1
          from public.platform_staff ps
          where ps.id = auth.uid() and ps.is_active = true
        )
        and exists (
          select 1
          from public.tenants t
          where t.id::text = auth.jwt() -> 'app_metadata' ->> 'tenant_id'
            and t.status not in ('suspended', 'cancelled')
        )
      then 'readonly'
    end,
    ''
  );
$$;

comment on function public.current_profile_role() is
  'Returns a role only when canonical profile and trusted claims match, or for an active platform staff readonly impersonation session.';

-- ---------------------------------------------------------------------------
-- Immutable audit boundary
-- ---------------------------------------------------------------------------

drop policy if exists audit_tenant_insert on public.audit_logs;

revoke all privileges on table public.audit_logs
  from public, anon, authenticated, service_role;
revoke all privileges on table public.platform_audit_logs
  from public, anon, authenticated, service_role;

grant select on table public.audit_logs to authenticated;
grant select, insert on table public.audit_logs to service_role;
grant select, insert on table public.platform_audit_logs to service_role;

-- ---------------------------------------------------------------------------
-- Service-only, bounded, O(1) rate limiter
-- ---------------------------------------------------------------------------

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_sec integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_hits integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_key is null or char_length(btrim(p_key)) < 1 or char_length(p_key) > 256 then
    raise exception 'Rate-limit key length must be between 1 and 256.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'Rate-limit limit must be between 1 and 10000.' using errcode = '22023';
  end if;
  if p_window_sec is null or p_window_sec < 1 or p_window_sec > 604800 then
    raise exception 'Rate-limit window must be between 1 and 604800 seconds.' using errcode = '22023';
  end if;

  insert into public.rate_limits as rl (bucket, hits, window_end)
  values (p_key, 1, v_now + make_interval(secs => p_window_sec))
  on conflict (bucket) do update
  set
    hits = case
      when rl.window_end <= v_now then 1
      else least(rl.hits::bigint + 1, p_limit::bigint + 1)::integer
    end,
    window_end = case
      when rl.window_end <= v_now then v_now + make_interval(secs => p_window_sec)
      else rl.window_end
    end
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

revoke all privileges on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.check_rate_limit(text, integer, integer)
  to service_role;
revoke all privileges on table public.rate_limits
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.rate_limits to service_role;

-- ---------------------------------------------------------------------------
-- Open-house counter: never expose a cross-tenant SECURITY DEFINER mutation
-- ---------------------------------------------------------------------------

create or replace function public.increment_visitor_count(open_house_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if open_house_id is null then
    raise exception 'Open house id is required.' using errcode = '22023';
  end if;

  -- Compatibility RPC for rolling deploys: reconcile to the canonical row
  -- count instead of incrementing twice when the trigger already ran.
  update public.open_houses oh
  set visitor_count = (
    select count(*)::integer
    from public.open_house_visitors v
    where v.open_house_id = oh.id
  )
  where oh.id = open_house_id;

  if not found then
    raise exception 'Open house not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all privileges on function public.increment_visitor_count(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.increment_visitor_count(uuid) to service_role;

create or replace function public.sync_open_house_visitor_count_v2()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.open_houses oh
    set visitor_count = coalesce(oh.visitor_count, 0) + 1
    where oh.id = new.open_house_id;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.open_house_id is distinct from old.open_house_id then
      update public.open_houses oh
      set visitor_count = greatest(coalesce(oh.visitor_count, 0) - 1, 0)
      where oh.id = old.open_house_id;

      update public.open_houses oh
      set visitor_count = coalesce(oh.visitor_count, 0) + 1
      where oh.id = new.open_house_id;
    end if;
    return new;
  end if;

  update public.open_houses oh
  set visitor_count = greatest(coalesce(oh.visitor_count, 0) - 1, 0)
  where oh.id = old.open_house_id;
  return old;
end;
$$;

revoke all privileges on function public.sync_open_house_visitor_count_v2()
  from public, anon, authenticated, service_role;

update public.open_houses oh
set visitor_count = (
  select count(*)::integer
  from public.open_house_visitors v
  where v.open_house_id = oh.id
);

drop trigger if exists trg_sync_open_house_visitor_count_v2
  on public.open_house_visitors;
create trigger trg_sync_open_house_visitor_count_v2
after insert or delete or update of open_house_id on public.open_house_visitors
for each row execute function public.sync_open_house_visitor_count_v2();

-- ---------------------------------------------------------------------------
-- Ticket lifecycle: immutable SLA history and complete terminal records
-- ---------------------------------------------------------------------------

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
      end if;
      if new.resolved_at is null and new.closed_at is null then
        new.resolution_due_at := coalesce(new.reopened_at, new.created_at)
          + public.support_resolution_interval(new.priority);
      end if;
    end if;

    -- These columns are historical evidence. Reopen and priority changes may
    -- create a new deadline, but must never erase a previous breach timestamp.
    new.first_response_breached_at := coalesce(
      old.first_response_breached_at,
      new.first_response_breached_at
    );
    new.resolution_breached_at := coalesce(
      old.resolution_breached_at,
      new.resolution_breached_at
    );
    new.version := old.version + 1;
  end if;
  return new;
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
  v_resolution_code text;
  v_resolution_summary text;
  v_first_response_late boolean := false;
  v_resolution_late boolean := false;
begin
  perform public.support_require_service_role();

  if p_status not in ('open', 'in_progress', 'waiting', 'resolved', 'closed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  if p_actor_kind not in ('tenant', 'staff')
    or not public.support_actor_is_valid(p_actor_id, p_actor_kind, p_tenant_id) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;
  if p_status not in ('resolved', 'closed') and (
    nullif(btrim(coalesce(p_resolution_code, '')), '') is not null
    or nullif(btrim(coalesce(p_resolution_summary, '')), '') is not null
  ) then
    raise exception 'Resolution details require a terminal status.' using errcode = '22023';
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
  if p_status in ('resolved', 'closed') then
    v_resolution_code := coalesce(
      nullif(btrim(p_resolution_code), ''),
      nullif(btrim(v_ticket.resolution_code), ''),
      case when p_actor_kind = 'tenant' then 'closed_by_customer' end
    );
    v_resolution_summary := coalesce(
      nullif(btrim(p_resolution_summary), ''),
      nullif(btrim(v_ticket.resolution_summary), ''),
      case when p_actor_kind = 'tenant' then 'Müşteri talebi kapattı.' end
    );

    if v_resolution_code is null or char_length(v_resolution_code) not between 1 and 80 then
      raise exception 'Resolution code is required.' using errcode = '22023';
    end if;
    if v_resolution_summary is null or char_length(v_resolution_summary) not between 3 and 2000 then
      raise exception 'Resolution summary is required.' using errcode = '22023';
    end if;
  end if;

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

  v_reopen := v_old_status in ('resolved', 'closed')
    and p_status in ('open', 'in_progress', 'waiting');
  v_first_response_late := v_old_status in ('open', 'in_progress', 'waiting')
    and p_status in ('resolved', 'closed')
    and v_ticket.first_response_at is null
    and v_ticket.first_response_breached_at is null
    and v_ticket.first_response_due_at < v_now;
  v_resolution_late := v_old_status in ('open', 'in_progress', 'waiting')
    and p_status in ('resolved', 'closed')
    and v_ticket.resolution_breached_at is null
    and v_ticket.resolution_due_at < v_now;

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
      when p_status in ('resolved', 'closed') then v_resolution_code
      when v_reopen then null
      else resolution_code
    end,
    resolution_summary = case
      when p_status in ('resolved', 'closed') then v_resolution_summary
      when v_reopen then null
      else resolution_summary
    end,
    reopened_at = case when v_reopen then v_now else reopened_at end,
    reopen_count = reopen_count + case when v_reopen then 1 else 0 end,
    first_response_at = case
      when p_actor_kind = 'staff' and p_status in ('resolved', 'closed')
        then coalesce(first_response_at, v_now)
      else first_response_at
    end,
    first_response_breached_at = case
      when v_first_response_late then coalesce(first_response_breached_at, v_now)
      else first_response_breached_at
    end,
    first_response_due_at = case
      when v_reopen and first_response_at is null
        then v_now + public.support_first_response_interval(priority)
      else first_response_due_at
    end,
    resolution_due_at = case
      when v_reopen then v_now + public.support_resolution_interval(priority)
      else resolution_due_at
    end,
    resolution_breached_at = case
      when v_resolution_late then coalesce(resolution_breached_at, v_now)
      else resolution_breached_at
    end,
    last_activity_at = v_now,
    updated_at = v_now
  where id = p_ticket_id
  returning * into v_ticket;

  if v_first_response_late then
    perform public.support_record_event(
      v_ticket.id,
      v_ticket.tenant_id,
      p_actor_id,
      p_actor_kind,
      'sla_first_response_breach',
      'internal',
      null,
      jsonb_build_object('due_at', v_ticket.first_response_due_at, 'captured_on_terminal', true)
    );
  end if;

  if v_resolution_late then
    perform public.support_record_event(
      v_ticket.id,
      v_ticket.tenant_id,
      p_actor_id,
      p_actor_kind,
      'sla_resolution_breach',
      'internal',
      null,
      jsonb_build_object('due_at', v_ticket.resolution_due_at, 'captured_on_terminal', true)
    );
  end if;

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

-- Normalize legacy terminal rows before validating the stronger invariant.
update public.support_tickets
set
  resolved_at = coalesce(resolved_at, closed_at, updated_at, created_at, clock_timestamp()),
  resolution_code = coalesce(nullif(btrim(resolution_code), ''), 'legacy_resolution'),
  resolution_summary = case
    when char_length(btrim(coalesce(resolution_summary, ''))) between 3 and 2000
      then btrim(resolution_summary)
    else 'Geçmiş çözüm kaydı migration sırasında tamamlandı.'
  end,
  closed_at = case
    when status = 'closed' then coalesce(closed_at, updated_at, created_at, clock_timestamp())
    else null
  end
where status in ('resolved', 'closed');

update public.support_tickets
set
  resolved_at = null,
  closed_at = null,
  resolution_code = null,
  resolution_summary = null
where status in ('open', 'in_progress', 'waiting')
  and (
    resolved_at is not null
    or closed_at is not null
    or resolution_code is not null
    or resolution_summary is not null
  );

alter table public.support_tickets
  drop constraint if exists support_tickets_terminal_integrity_v3,
  add constraint support_tickets_terminal_integrity_v3 check (
    (
      status in ('open', 'in_progress', 'waiting')
      and resolved_at is null
      and closed_at is null
      and resolution_code is null
      and resolution_summary is null
    )
    or (
      status = 'resolved'
      and resolved_at is not null
      and closed_at is null
      and resolution_code is not null
      and resolution_summary is not null
      and char_length(btrim(resolution_code)) between 1 and 80
      and char_length(btrim(resolution_summary)) between 3 and 2000
    )
    or (
      status = 'closed'
      and resolved_at is not null
      and closed_at is not null
      and resolution_code is not null
      and resolution_summary is not null
      and char_length(btrim(resolution_code)) between 1 and 80
      and char_length(btrim(resolution_summary)) between 3 and 2000
    )
  ) not valid;

alter table public.support_tickets
  validate constraint support_tickets_terminal_integrity_v3;

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
  v_result jsonb;
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
  if p_field = 'status' and p_value in ('resolved', 'closed') then
    raise exception 'Bulk terminal transitions require per-ticket resolution evidence.'
      using errcode = '22023';
  end if;

  foreach v_id in array p_ticket_ids loop
    if p_field = 'status' then
      v_result := public.transition_support_ticket_v2(
        v_id,
        null,
        p_actor_id,
        'staff',
        p_value,
        null,
        null
      );
      if coalesce((v_result ->> 'already')::boolean, false) = false then
        v_count := v_count + 1;
      end if;
    else
      perform public.admin_update_support_ticket_v2(v_id, p_actor_id, p_field, p_value);
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

-- Historical breach timestamps remain available for audits; live KPI values
-- are derived from the current cycle's due dates.
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
          and first_response_at is null
          and first_response_due_at < now()
      )::integer as first_response_breached,
      count(*) filter (
        where status in ('open', 'in_progress', 'waiting')
          and resolution_due_at < now()
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
    select d.day, count(s.id)::integer as count_value
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

revoke all privileges on function public.transition_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.transition_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, text
) to service_role;

revoke all privileges on function public.bulk_update_support_tickets_v2(
  uuid[], uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.bulk_update_support_tickets_v2(
  uuid[], uuid, text, text
) to service_role;

revoke all privileges on function public.support_ticket_metrics_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.support_ticket_metrics_v2(uuid) to service_role;

notify pgrst, 'reload schema';
