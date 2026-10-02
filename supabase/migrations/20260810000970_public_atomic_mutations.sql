-- Public capability links are bearer credentials, but their mutations still
-- need database-level single-winner semantics. These SECURITY DEFINER RPCs are
-- callable only with the service role; public Server Actions validate/rate
-- limit input and pass only the bearer token plus the requested transition.

-- ---------------------------------------------------------------------------
-- Online booking: serialize reservations for one staff booking setting, then
-- revalidate the live schedule and create the customer/appointment atomically.
-- ---------------------------------------------------------------------------
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
$$;

revoke all on function public.create_public_booking_atomic(
  uuid, timestamptz, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_booking_atomic(
  uuid, timestamptz, text, text, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Owner offer decision: lock the offer after deriving tenant/property only
-- from the live bearer token. A stale CAS returns already_finalized and causes
-- no audit, notification, or success response in the action.
-- ---------------------------------------------------------------------------
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
  v_token text := btrim(coalesce(p_token, ''));
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_tenant_id uuid;
  v_property_id uuid;
  v_owner_name text;
  v_property_assigned_to uuid;
  v_property_code text;
  v_property_title text;
  v_offer public.offers%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if char_length(v_token) not between 1 and 256
     or p_offer_id is null
     or v_decision not in ('accepted', 'rejected') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select
    opt.tenant_id,
    opt.property_id,
    opt.owner_name,
    p.assigned_to,
    p.property_code,
    p.title
  into
    v_tenant_id,
    v_property_id,
    v_owner_name,
    v_property_assigned_to,
    v_property_code,
    v_property_title
  from public.owner_portal_tokens opt
  inner join public.tenants t
    on t.id = opt.tenant_id
   and t.status in ('trial', 'active', 'past_due')
  inner join public.properties p
    on p.id = opt.property_id
   and p.tenant_id = opt.tenant_id
   and p.deleted_at is null
  where opt.token = v_token
    and opt.expires_at >= v_now;

  if not found then
    return jsonb_build_object('outcome', 'invalid_link');
  end if;

  select o.*
    into v_offer
  from public.offers o
  where o.id = p_offer_id
    and o.tenant_id = v_tenant_id
    and o.property_id = v_property_id
  for update of o;

  if not found then
    return jsonb_build_object('outcome', 'offer_not_found');
  end if;
  if v_offer.status <> 'submitted'::public.offer_status then
    return jsonb_build_object(
      'outcome', 'already_finalized',
      'current_status', v_offer.status::text
    );
  end if;

  update public.offers
     set status = v_decision::public.offer_status,
         responded_at = v_now,
         updated_at = v_now
   where id = v_offer.id
     and tenant_id = v_tenant_id
     and status = 'submitted'::public.offer_status;
  if not found then
    raise exception 'Offer transition target changed.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'outcome', 'applied',
    'offer_id', v_offer.id,
    'tenant_id', v_tenant_id,
    'property_id', v_property_id,
    'owner_name', v_owner_name,
    'property_assigned_to', v_property_assigned_to,
    'property_code', v_property_code,
    'property_title', v_property_title,
    'created_by', v_offer.created_by,
    'amount', v_offer.amount,
    'decision', v_decision
  );
end;
$$;

revoke all on function public.respond_owner_offer_atomic(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.respond_owner_offer_atomic(text, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Appointment confirmation: exact replay is idempotent, but a contradictory
-- response can never overwrite the first committed answer.
-- ---------------------------------------------------------------------------
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
  v_response text := lower(btrim(coalesce(p_response, '')));
  v_appointment record;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_confirm_token is null or v_response not in ('coming', 'cancelled') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select
    a.id,
    a.tenant_id,
    a.scheduled_at,
    a.status,
    a.customer_response,
    a.assigned_to,
    coalesce(c.full_name, 'Müşteri') as customer_name
  into v_appointment
  from public.appointments a
  inner join public.tenants t
    on t.id = a.tenant_id
   and t.status in ('trial', 'active', 'past_due')
  left join public.customers c
    on c.id = a.customer_id
   and c.tenant_id = a.tenant_id
  where a.confirm_token = p_confirm_token
  for update of a;

  if not found then
    return jsonb_build_object('outcome', 'invalid_link');
  end if;

  -- Check replay before time/status closure so retrying an already committed
  -- response remains a true idempotent success without another notification.
  if v_appointment.customer_response = v_response then
    return jsonb_build_object(
      'outcome', 'replay',
      'response', v_response
    );
  end if;
  if v_appointment.customer_response is not null then
    return jsonb_build_object(
      'outcome', 'already_responded',
      'current_response', v_appointment.customer_response
    );
  end if;
  if v_appointment.scheduled_at <= v_now then
    return jsonb_build_object('outcome', 'appointment_past');
  end if;
  if v_appointment.status in ('cancelled', 'completed') then
    return jsonb_build_object('outcome', 'appointment_closed');
  end if;

  update public.appointments
     set customer_response = v_response,
         responded_at = v_now,
         updated_at = v_now,
         status = case
           when v_response = 'cancelled' then 'cancelled'
           else status
         end
   where id = v_appointment.id
     and tenant_id = v_appointment.tenant_id
     and customer_response is null;
  if not found then
    raise exception 'Appointment response target changed.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'outcome', 'applied',
    'appointment_id', v_appointment.id,
    'tenant_id', v_appointment.tenant_id,
    'scheduled_at', v_appointment.scheduled_at,
    'assigned_to', v_appointment.assigned_to,
    'customer_name', v_appointment.customer_name,
    'response', v_response
  );
end;
$$;

revoke all on function public.respond_appointment_confirmation_atomic(uuid, text)
  from public, anon, authenticated;
grant execute on function public.respond_appointment_confirmation_atomic(uuid, text)
  to service_role;
