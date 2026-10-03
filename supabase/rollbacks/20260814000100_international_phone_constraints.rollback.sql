-- Rollback: 20260814000100_international_phone_constraints
-- Eski TR-cep kisitlari geri konur (NOT VALID: yabanci numarali satir varsa hata vermez, yeni yazimlari engeller).

alter table public.customers drop constraint if exists customers_phone_tr_format;
alter table public.customers
  add constraint customers_phone_tr_format
  check (phone is null or phone ~ '^05\d{9}$') not valid;

alter table public.calls drop constraint if exists calls_phone_tr_format;
alter table public.calls
  add constraint calls_phone_tr_format
  check (phone ~ '^05\d{9}$') not valid;

CREATE OR REPLACE FUNCTION public.create_public_booking_atomic_state_v1(p_public_token uuid, p_start_at timestamp with time zone, p_full_name text, p_phone text, p_email text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_setting public.booking_settings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_local_start timestamp without time zone;
  v_local_today date;
  v_weekday_key text;
  v_hours jsonb;
  v_open_text text;
  v_close_text text;
  v_open_minutes integer;
  v_close_minutes integer;
  v_start_minutes integer;
  v_buffer interval;
  v_appointment_end timestamptz;
  v_customer_id uuid;
  v_appointment_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  if p_public_token is null
     or p_start_at is null
     or not isfinite(p_start_at)
     or char_length(btrim(coalesce(p_full_name, ''))) not between 1 and 160
     or btrim(coalesce(p_phone, '')) !~ '^05[0-9]{9}$'
     or char_length(btrim(coalesce(p_email, ''))) > 320
     or char_length(btrim(coalesce(p_note, ''))) > 1000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- The row lock is the booking-slot mutex. All public reservations for this
  -- staff member share one booking_settings row, so a waiter rechecks conflicts
  -- after the previous transaction commits and exactly one request can win.
  select bs.*
    into v_setting
  from public.booking_settings bs
  inner join public.tenants t
    on t.id = bs.tenant_id
   and t.status in ('trial', 'active', 'past_due')
  inner join public.profiles p
    on p.id = bs.staff_id
   and p.tenant_id = bs.tenant_id
   and p.is_active = true
  where bs.public_token = p_public_token
    and bs.is_active = true
  for update of bs;

  if not found then
    return jsonb_build_object('outcome', 'invalid_link');
  end if;

  v_local_start := p_start_at at time zone 'Europe/Istanbul';
  v_local_today := (v_now at time zone 'Europe/Istanbul')::date;
  v_weekday_key := (extract(isodow from v_local_start)::integer)::text;
  v_hours := v_setting.weekday_hours -> v_weekday_key;
  if v_hours is null and v_weekday_key = '7' then
    v_hours := v_setting.weekday_hours -> '0';
  end if;

  if jsonb_typeof(v_hours) is distinct from 'array' then
    return jsonb_build_object('outcome', 'slot_unavailable');
  end if;
  if jsonb_array_length(v_hours) < 2 then
    return jsonb_build_object('outcome', 'slot_unavailable');
  end if;
  v_open_text := btrim(v_hours ->> 0);
  v_close_text := btrim(v_hours ->> 1);
  if v_open_text is null
     or v_close_text is null
     or v_open_text !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
     or v_close_text !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
    return jsonb_build_object('outcome', 'slot_unavailable');
  end if;

  v_open_minutes := split_part(v_open_text, ':', 1)::integer * 60
                    + split_part(v_open_text, ':', 2)::integer;
  v_close_minutes := split_part(v_close_text, ':', 1)::integer * 60
                     + split_part(v_close_text, ':', 2)::integer;
  v_start_minutes := extract(hour from v_local_start)::integer * 60
                     + extract(minute from v_local_start)::integer;

  if v_close_minutes <= v_open_minutes
     or extract(second from v_local_start) <> 0
     or v_local_start::date < v_local_today
     or v_local_start::date >= v_local_today + v_setting.max_days_ahead
     or p_start_at < v_now + make_interval(hours => v_setting.min_hours_notice)
     or v_start_minutes < v_open_minutes
     or v_start_minutes + v_setting.slot_minutes > v_close_minutes
     or mod(v_start_minutes - v_open_minutes, v_setting.slot_minutes) <> 0 then
    return jsonb_build_object('outcome', 'slot_unavailable');
  end if;

  if exists (
    select 1
    from public.staff_leaves l
    where l.tenant_id = v_setting.tenant_id
      and l.staff_id = v_setting.staff_id
      and l.status = 'onayli'
      and v_local_start::date between l.starts_on and l.ends_on
  ) then
    return jsonb_build_object('outcome', 'staff_unavailable');
  end if;

  v_buffer := make_interval(mins => v_setting.buffer_minutes);
  v_appointment_end := p_start_at + make_interval(mins => v_setting.slot_minutes);
  if exists (
    select 1
    from public.appointments a
    where a.tenant_id = v_setting.tenant_id
      and a.assigned_to = v_setting.staff_id
      and a.status <> 'cancelled'
      and p_start_at < a.scheduled_at
          + make_interval(mins => greatest(coalesce(a.duration_min, 60), 1))
          + v_buffer
      and a.scheduled_at - v_buffer < v_appointment_end
  ) then
    return jsonb_build_object('outcome', 'slot_unavailable');
  end if;

  -- Avoid creating two customer rows when the same phone books concurrently
  -- through two different staff links in the same tenant.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'public-booking-customer:' || v_setting.tenant_id::text || ':' || btrim(p_phone),
      0
    )
  );

  select c.id
    into v_customer_id
  from public.customers c
  where c.tenant_id = v_setting.tenant_id
    and c.phone = btrim(p_phone)
    and c.deleted_at is null
  order by c.created_at, c.id
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
      tenant_id,
      full_name,
      phone,
      email,
      source,
      assigned_to,
      created_by,
      notes
    ) values (
      v_setting.tenant_id,
      btrim(p_full_name),
      btrim(p_phone),
      nullif(btrim(coalesce(p_email, '')), ''),
      'online randevu',
      v_setting.staff_id,
      v_setting.staff_id,
      'Online randevu linkinden kendisi kaydoldu'
    )
    returning id into v_customer_id;
  end if;

  insert into public.appointments (
    tenant_id,
    customer_id,
    appointment_type,
    scheduled_at,
    duration_min,
    status,
    notes,
    assigned_to,
    created_by
  ) values (
    v_setting.tenant_id,
    v_customer_id,
    'office',
    p_start_at,
    v_setting.slot_minutes,
    'pending',
    case
      when nullif(btrim(coalesce(p_note, '')), '') is null
        then 'Online randevu (müşteri kendisi aldı)'
      else 'Online randevu — ' || btrim(p_note)
    end,
    v_setting.staff_id,
    v_setting.staff_id
  )
  returning id into v_appointment_id;

  return jsonb_build_object(
    'outcome', 'created',
    'appointment_id', v_appointment_id,
    'customer_id', v_customer_id,
    'tenant_id', v_setting.tenant_id,
    'staff_id', v_setting.staff_id,
    'scheduled_at', p_start_at,
    'duration_min', v_setting.slot_minutes
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_public_booking_atomic(p_public_token uuid, p_start_at timestamp with time zone, p_full_name text, p_phone text, p_email text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

revoke all on function public.create_public_booking_atomic_state_v1(uuid, timestamptz, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.create_public_booking_atomic(uuid, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_public_booking_atomic(uuid, timestamptz, text, text, text, text) to service_role;
