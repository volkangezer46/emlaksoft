-- Destek talebi mutasyon RPC'leri `support_tickets.version` kolonunu (ve onu
-- otomatik artıran trigger'ı) hiç okumuyor/kontrol etmiyordu — iki personel
-- aynı talebi aynı anda işlerse biri diğerinin çözüm kaydını/atamasını
-- sessizce ezebiliyordu. Her RPC'ye opsiyonel `p_expected_version` parametresi
-- eklenir; NULL verilirse eski davranış aynen sürer (geriye dönük uyumlu),
-- verilirse ve satırın GÜNCEL version'ı ile uyuşmazsa `VERSION_CONFLICT:` ile
-- başlayan bir istisna fırlatılır (TS tarafı bunu greplenebilir şekilde
-- yakalayıp kullanıcıya dostça bir mesaj gösterir).
--
-- `bulk_update_support_tickets_v2` kapsam dışı bırakıldı: N bilet için tek bir
-- version alınamaz, `p_ticket_ids uuid[]` yerine `(id, version)[]` gerektirir —
-- bu, ayrı ve daha büyük bir değişiklik.

drop function if exists public.reply_support_ticket_v2(uuid, uuid, uuid, text, text, text, uuid);

create or replace function public.reply_support_ticket_v2(
  p_ticket_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_body text,
  p_visibility text,
  p_request_id uuid,
  p_expected_version bigint default null
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

  if p_expected_version is not null and v_ticket.version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT: Bu talep başkası tarafından güncellendi (beklenen %, güncel %).',
      p_expected_version, v_ticket.version using errcode = 'P0001';
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

revoke all privileges on function public.reply_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, uuid, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.reply_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, uuid, bigint
) to service_role;

-- ---------------------------------------------------------------------------

drop function if exists public.transition_support_ticket_v2(uuid, uuid, uuid, text, text, text, text);

create or replace function public.transition_support_ticket_v2(
  p_ticket_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_status text,
  p_resolution_code text default null,
  p_resolution_summary text default null,
  p_expected_version bigint default null
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
  if p_expected_version is not null and v_ticket.version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT: Bu talep başkası tarafından güncellendi (beklenen %, güncel %).',
      p_expected_version, v_ticket.version using errcode = 'P0001';
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

revoke all privileges on function public.transition_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.transition_support_ticket_v2(
  uuid, uuid, uuid, text, text, text, text, bigint
) to service_role;

-- ---------------------------------------------------------------------------

drop function if exists public.admin_update_support_ticket_v2(uuid, uuid, text, text);

create or replace function public.admin_update_support_ticket_v2(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_field text,
  p_value text,
  p_expected_version bigint default null
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
  if p_expected_version is not null and v_ticket.version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT: Bu talep başkası tarafından güncellendi (beklenen %, güncel %).',
      p_expected_version, v_ticket.version using errcode = 'P0001';
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

revoke all privileges on function public.admin_update_support_ticket_v2(
  uuid, uuid, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_support_ticket_v2(
  uuid, uuid, text, text, bigint
) to service_role;
