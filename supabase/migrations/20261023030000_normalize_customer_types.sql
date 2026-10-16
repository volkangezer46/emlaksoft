-- Müşteri türü kanonik yazım (R3 veri doğruluğu): customers.customer_types içindeki eş anlamlı/ASCII yazımları
-- tanım tablosunun kanonik değerlerine çevirir + kampanya tür süzgecini kanonik değerlerle eşleştirir.
--
-- NEDEN: web formu/başvuru akışı (src/lib/lead-intake.ts) varsayılan türü ASCII "alici" yazıyordu; müşteri türü
--   süzgecinde "Alıcı 70" yanında "alici 1" ayrı tür görünüyordu. Ayrıca create_campaign_with_recipients "type:alici"
--   süzgecini değerin KENDİSİYLE (customer_types @> '{alici}') eşleştiriyordu: "Sadece alıcılar" kampanyası kanonik
--   "Alıcı" müşterileri hiç kapsamıyordu ("type:kira" hiçbir müşteriyi).
-- NE: (1) VERİ: her müşterinin tür dizisi büyük/küçük harf ve Türkçe karakter farkı yok sayılarak eşlenir
--   (src/lib/customer-types.ts CUSTOMER_TYPE_ALIASES ile BİREBİR): alici/buyer → Alıcı · satici/seller → Satıcı ·
--   kiraci/tenant → Kiracı · mulk sahibi/malik/ev sahibi/owner → Mülk sahibi · yatirimci/investor → Yatırımcı.
--   Eşlemede olmayan özel türler kırpılıp aynen kalır; sıra korunur, tekrar atılır; yalnız DEĞİŞEN satır yazılır.
--   (2) FONKSİYON: gövde 20261016110100 tanımından alındı; YALNIZ tür süzgeci kanonik değerle (+eski ASCII yazım)
--   eşleşir. Kiracı, silinmiş kayıt, kara liste, telefon kapıları, filtre doğrulaması ve WhatsApp sözleşmesi BİREBİR aynı;
--   CREATE OR REPLACE ACL'yi korur (service_role yalnız).
-- GERI ALMA: supabase/rollbacks/20261023030000_normalize_customer_types.rollback.sql (fonksiyon 20261016110100 gövdesine
--   döner). Veri düzeltmesi geri alınmaz (kanonik yazım zaten tanım tablosunun değeridir; uygulama okurken de eşler).
-- RISK: düşük (customers üzerinde customer_types kolonunu izleyen tetik yok; tek UPDATE, değişmeyen satıra dokunmaz).

set local lock_timeout = '5s';

with alias(k, canonical) as (
  values
    ('alici', 'Alıcı'), ('buyer', 'Alıcı'),
    ('satici', 'Satıcı'), ('seller', 'Satıcı'),
    ('kiraci', 'Kiracı'), ('tenant', 'Kiracı'),
    ('mulk sahibi', 'Mülk sahibi'), ('malik', 'Mülk sahibi'), ('ev sahibi', 'Mülk sahibi'), ('owner', 'Mülk sahibi'),
    ('yatirimci', 'Yatırımcı'), ('investor', 'Yatırımcı')
),
expanded as (
  select c.id, t.ord,
         coalesce(a.canonical, btrim(t.raw)) as v
    from public.customers c
    cross join lateral unnest(c.customer_types) with ordinality as t(raw, ord)
    left join alias a
      on a.k = regexp_replace(lower(translate(btrim(t.raw), 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')), '[[:space:]_-]+', ' ', 'g')
   where btrim(coalesce(t.raw, '')) <> ''
),
dedup as (
  select id, v, min(ord) as ord from expanded group by id, v
),
rebuilt as (
  select id, array_agg(v order by ord) as types from dedup group by id
)
update public.customers c
   set customer_types = r.types
  from rebuilt r
 where r.id = c.id
   and c.customer_types is distinct from r.types;

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
  v_filter_raw text := btrim(coalesce(p_filter, 'all'));
  v_filter_kind text;
  v_filter_tag text;
  v_filter_id uuid;
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
  -- Hedef kitle: all | type:alici|satici|kira (→ Alıcı | Satıcı | Kiracı) | tag:<etiket> | district:<uuid> | advisor:<uuid>
  -- (src/lib/campaign-audience.ts ile aynı katılık; etiket ve uuid küçük/büyük harf dönüştürülmeden doğrulanır).
  if v_filter in ('all', 'type:alici', 'type:satici', 'type:kira') then
    v_filter_kind := split_part(v_filter, ':', 1);
  elsif left(v_filter_raw, 4) = 'tag:' then
    v_filter_kind := 'tag';
    v_filter_tag := substr(v_filter_raw, 5);
    if char_length(v_filter_tag) < 1
       or char_length(v_filter_tag) > 30
       or v_filter_tag ~ '[[:cntrl:]]'
       or v_filter_tag is distinct from regexp_replace(btrim(v_filter_tag), '[[:space:]]+', ' ', 'g') then
      raise exception 'Invalid campaign audience filter.' using errcode = '22023';
    end if;
  elsif v_filter_raw ~ '^(district|advisor):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_filter_kind := split_part(v_filter_raw, ':', 1);
    v_filter_id := split_part(v_filter_raw, ':', 2)::uuid;
  else
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
      v_filter_kind = 'all'
      -- Tür süzgeci kanonik yazımla eşleşir (eski ASCII yazım da kabul: göç sonrası yeni kayıt yine de kaçmasın).
      or (v_filter_kind = 'type' and c.customer_types && (case split_part(v_filter, ':', 2)
            when 'alici' then array['Alıcı', 'alici']
            when 'satici' then array['Satıcı', 'satici']
            when 'kira' then array['Kiracı', 'kiraci']
          end)::text[])
      or (v_filter_kind = 'tag' and c.tags @> array[v_filter_tag]::text[])
      or (v_filter_kind = 'advisor' and c.assigned_to = v_filter_id)
      or (
        v_filter_kind = 'district'
        and exists (
          select 1
          from public.customer_demands d
          where d.tenant_id = p_tenant_id
            and d.customer_id = c.id
            and d.district_id = v_filter_id
            and d.status in ('new', 'active', 'matched')
        )
      )
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
