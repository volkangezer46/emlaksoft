-- Geçersiz düzenli ifade düzeltmesi (canlı hata: campaign-delivery cron her 2 dk `campaign_claim_failed:2201B`).
--
-- NEDEN: PostgreSQL ARE tekrar sınırı 255'tir (RE_DUP_MAX); `{1,512}` çalışma anında 2201B "invalid repetition count(s)"
--   verir. İfade claim_campaign_delivery, verify_campaign_recipient_consent, create_campaign_with_recipients fonksiyonlarında
--   ve campaigns_whatsapp_template_contract / survey_settings_whatsapp_template_check kısıtlarında geçiyordu: kuyrukta kayıt
--   varken cron, WhatsApp şablonlu kampanya/anket ayarı kaydı hata veriyordu.
-- NE: anlamı BİREBİR aynı (1-512 karakter, [a-z0-9_]) geçerli ifade: '^(?:[a-z0-9_]{1,255})(?:[a-z0-9_]{0,255})(?:[a-z0-9_]{0,2})$'.
--   Fonksiyon gövdeleri canlı tanımdan (pg_get_functiondef, 2026-10-08) alındı; yalnız ifade değişti; CREATE OR REPLACE ACL'yi korur.
--   Kısıtlar düşürülüp aynı koşulla yeniden kurulur (campaigns NOT VALID olarak kalır; survey_settings doğrulanır).
-- GERI ALMA: rollbacks/20261008000900_fix_regex_repetition_limit.rollback.sql (bilinçli olarak eski geçersiz ifadeye dönmez; no-op).
-- RISK: düşük (anlam aynı; canlıda whatsapp_template_name dolu kampanya 0).

set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.create_campaign_with_recipients(p_tenant_id uuid, p_created_by uuid, p_title text, p_channel text, p_message text, p_filter text DEFAULT 'all'::text, p_whatsapp_template_name text DEFAULT NULL::text, p_whatsapp_template_language text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    if v_whatsapp_template_name !~ '^(?:[a-z0-9_]{1,255})(?:[a-z0-9_]{0,255})(?:[a-z0-9_]{0,2})$'
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
       or v_campaign.whatsapp_template_name !~ '^(?:[a-z0-9_]{1,255})(?:[a-z0-9_]{0,255})(?:[a-z0-9_]{0,2})$'
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

CREATE OR REPLACE FUNCTION public.claim_campaign_delivery(p_campaign_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_campaign public.campaigns%rowtype;
  v_token uuid := gen_random_uuid();
  v_lease interval := make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600)));
begin
  -- Sablon sozlesmesine uymayan WhatsApp kampanyalari gonderilemez: kuyruktan cikar.
  update public.campaigns c
     set status = 'failed',
         processing_token = null,
         processing_started_at = null,
         last_error = 'whatsapp_template_invalid'
   where c.channel::text = 'whatsapp'
     and c.status in ('scheduled', 'sending')
     and (p_campaign_id is null or c.id = p_campaign_id)
     and (p_tenant_id is null or c.tenant_id = p_tenant_id)
     and (
       c.whatsapp_template_name is null
       or c.whatsapp_template_name !~ '^(?:[a-z0-9_]{1,255})(?:[a-z0-9_]{0,255})(?:[a-z0-9_]{0,2})$'
       or c.whatsapp_template_language is null
       or c.whatsapp_template_language !~ '^[a-z]{2,3}(_[A-Z]{2})?$'
       or char_length(c.message) > 612
     );

  select c.*
    into v_campaign
  from public.campaigns c
  where (p_campaign_id is null or c.id = p_campaign_id)
    and (p_tenant_id is null or c.tenant_id = p_tenant_id)
    and exists (
      select 1
      from public.tenants t
      where t.id = c.tenant_id
        and t.status in ('trial', 'active', 'past_due')
    )
    and (
      (
        p_force
        and c.status in ('draft', 'scheduled', 'failed', 'sending')
      )
      or (
        not p_force
        and (
          (c.status = 'scheduled' and c.scheduled_at is not null and c.scheduled_at <= now())
          or c.status = 'sending'
        )
      )
    )
    and (
      c.channel::text <> 'whatsapp'
      or (
        c.whatsapp_template_name ~ '^(?:[a-z0-9_]{1,255})(?:[a-z0-9_]{0,255})(?:[a-z0-9_]{0,2})$'
        and c.whatsapp_template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'
        and char_length(c.message) <= 612
      )
    )
    and (
      c.processing_token is null
      or c.processing_started_at is null
      or c.processing_started_at < now() - v_lease
    )
  order by
    case when c.status = 'sending' then 0 else 1 end,
    coalesce(c.scheduled_at, c.created_at),
    c.created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  -- Başarısız kampanyada yalnız başarısız alıcılar tekrar kuyruğa alınır;
  -- daha önce ulaşan/izin dışı kalan alıcılara ikinci kez mesaj gitmez.
  if v_campaign.status = 'failed' then
    update public.campaign_recipients
       set status = 'pending', error_msg = null
     where campaign_id = v_campaign.id
       and status = 'failed';
  end if;

  update public.campaigns
     set status = 'sending',
         processing_token = v_token,
         processing_started_at = now(),
         last_error = null
   where id = v_campaign.id;

  return jsonb_build_object(
    'id', v_campaign.id,
    'tenant_id', v_campaign.tenant_id,
    'title', v_campaign.title,
    'channel', v_campaign.channel::text,
    'message', v_campaign.message,
    'previous_status', v_campaign.status::text,
    'scheduled_at', v_campaign.scheduled_at,
    'processing_token', v_token
  );
end;
$function$
;

alter table public.campaigns drop constraint if exists campaigns_whatsapp_template_contract;
alter table public.campaigns add constraint campaigns_whatsapp_template_contract check (
  ((status)::text = any (array['failed'::text, 'done'::text]))
  or (((channel)::text = 'whatsapp'::text) and (whatsapp_template_name is not null)
      and (whatsapp_template_name ~ '^(?:[a-z0-9_]{1,255})(?:[a-z0-9_]{0,255})(?:[a-z0-9_]{0,2})$'::text)
      and (whatsapp_template_language is not null) and (whatsapp_template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'::text)
      and (char_length(message) <= 612))
  or (((channel)::text <> 'whatsapp'::text) and (whatsapp_template_name is null) and (whatsapp_template_language is null))
) not valid;

alter table public.survey_settings drop constraint if exists survey_settings_whatsapp_template_check;
alter table public.survey_settings add constraint survey_settings_whatsapp_template_check check (
  (whatsapp_template is null) or (whatsapp_template ~ '^(?:[a-z0-9_]{1,255})(?:[a-z0-9_]{0,255})(?:[a-z0-9_]{0,2})$'::text)
);
