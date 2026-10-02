-- pgcrypto Supabase'de `extensions` şemasında durur. Aşağıdaki iki fonksiyon
-- `set search_path = public, pg_temp` ile çalıştığı için şemasız `digest()`
-- çağrısı çalışma anında "function digest(...) does not exist" hatası verir
-- (20260802000147 ve 20260810000920 ile uygulanmış, o dosyalar değiştirilemez).
-- Gövdeler canlı DB'deki tanımlardan alındı; tek fark `extensions.digest`.
-- CREATE OR REPLACE sahiplik ve yetkileri korur.

CREATE OR REPLACE FUNCTION public.rotate_lead_capture_token(p_tenant_id uuid, p_actor_id uuid, p_new_token text, p_reason text DEFAULT 'rotated'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      encode(extensions.digest(v_old_token, 'sha256'), 'hex'),
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
$function$
;

CREATE OR REPLACE FUNCTION public.verify_campaign_recipient_consent(p_campaign_id uuid, p_tenant_id uuid, p_processing_token uuid, p_recipient_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      extensions.digest(coalesce(v_consent_evidence, v_consent.meta, '{}'::jsonb)::text, 'sha256'),
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
$function$
;

