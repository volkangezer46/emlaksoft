-- 20261016100100 geri alma: create_campaign_with_recipients 20261008000900 gövdesine (yalnız all|type:* filtreleri) döner.
-- Gövde 20261008000900_fix_regex_repetition_limit.sql'den birebir alınmıştır; CREATE OR REPLACE ACL'yi korur.

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
