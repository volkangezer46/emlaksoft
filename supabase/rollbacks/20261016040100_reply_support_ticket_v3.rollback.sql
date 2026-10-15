-- Geri alma: 20261016040100_reply_support_ticket_v3.sql
-- reply_support_ticket_v2 eski (20260802000540) govdesine doner (ofis yaniti durumu kosulsuz 'in_progress' yapar),
-- reply_support_ticket_v3 kaldirilir. Tek seferlik durum duzeltmesi (in_progress -> open) GERI ALINMAZ (veri; PITR).
-- Kod v3 yokken (PGRST202) v2'ye duser.
set local lock_timeout = '5s';

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

revoke all on function public.reply_support_ticket_v2(uuid, uuid, uuid, text, text, text, uuid, bigint) from public;
do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.reply_support_ticket_v2(uuid, uuid, uuid, text, text, text, uuid, bigint) to service_role';
  end if;
end $$;

drop function if exists public.reply_support_ticket_v3(uuid, uuid, uuid, text, text, text, uuid, bigint);

notify pgrst, 'reload schema';
