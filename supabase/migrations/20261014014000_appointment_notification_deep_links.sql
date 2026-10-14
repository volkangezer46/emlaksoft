-- GP4: herkese acik randevu bildirimleri kaydin kendisini acar.
--  create_public_booking_atomic ('Online randevu: ...') ve respond_appointment_confirmation_atomic ('Randevu onaylandi/iptal
--  edildi') bildirim href'i genel /app/randevular yerine /app/randevular?randevu=<id> (tek randevu, duzenleme paneli acik).
--  Govdeler 20260814000100 / 20260810000990 tanimlariyla AYNI (canli pg_get_functiondef ile karsilastirildi); yalniz
--  p_notification_href degisir. Yetki satirlari ayni sekilde yeniden yazilir.
-- Bagimsiz; KOD YAYINIYLA AYNI pencerede ya da SONRA (?randevu= destegi kodda; once uygulanirsa eski kod parametreyi
--  yok sayar ve genel listeyi acar, kirilma yok). Mevcut bildirim satirlari DEGISMEZ (govdede randevu kimligi yok).

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
     or btrim(coalesce(p_phone, '')) !~ '^(0[0-9]{10}|\+[1-9][0-9]{6,14})$' then
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
    p_notification_href => '/app/randevular?randevu=' || v_appointment.id::text,
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

revoke all on function public.create_public_booking_atomic(uuid, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_public_booking_atomic(uuid, timestamptz, text, text, text, text) to service_role;

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
    p_notification_href => '/app/randevular?randevu=' || v_effect.id::text,
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
