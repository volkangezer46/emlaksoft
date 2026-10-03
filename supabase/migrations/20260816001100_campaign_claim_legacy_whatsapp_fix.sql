-- Kampanya teslimat claim'i: eski WhatsApp kampanyalari 23514 (check_violation) uretiyordu.
--
-- NEDEN: 20260810000920 campaigns_whatsapp_template_contract kisitini NOT VALID ekledi. NOT VALID yalniz
-- mevcut satirlarin taranmasini atlar; kisit o satira yapilan HER UPDATE'te yeniden sinanir.
-- claim_campaign_delivery (20260731000135) secilen kampanyayi 'sending' yaparken UPDATE atar. Sablon adi/dili
-- olmayan (veya mesaji 612 karakteri asan) eski WhatsApp kampanyasi zamanlanmis/sending durumundaysa bu UPDATE
-- 23514 ile patlar; kampanya her zaman sirada ilk oldugundan cron her tickte ayni hatayi alir ve diger
-- kampanyalar da bloke olur.
--
-- DUZELTME (forward-only, uygulanmis dosyalar degismez):
--  1) Kisit, terminal durumlar ('failed','done') icin gevsetilir; boylece gecersiz eski kampanya 'failed'
--     yapilabilir. Yeni/aktif satirlar icin sablon sozlesmesi aynen gecerlidir.
--  2) claim_campaign_delivery gecersiz WhatsApp kampanyalarini once 'failed' durumuna alir
--     (last_error: whatsapp_template_invalid) ve secimden dislar; sonsuz dongu kesilir.
-- Gonderim hic yapilmamis kampanyalar etkilenir; alici verisi degismez.

alter table public.campaigns
  drop constraint if exists campaigns_whatsapp_template_contract;
alter table public.campaigns
  add constraint campaigns_whatsapp_template_contract
  check (
    status::text in ('failed', 'done')
    or (
      channel::text = 'whatsapp'
      and whatsapp_template_name is not null
      and whatsapp_template_name ~ '^[a-z0-9_]{1,512}$'
      and whatsapp_template_language is not null
      and whatsapp_template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'
      and char_length(message) <= 612
    )
    or (
      channel::text <> 'whatsapp'
      and whatsapp_template_name is null
      and whatsapp_template_language is null
    )
  ) not valid;

create or replace function public.claim_campaign_delivery(
  p_campaign_id uuid default null,
  p_tenant_id uuid default null,
  p_force boolean default false,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
       or c.whatsapp_template_name !~ '^[a-z0-9_]{1,512}$'
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
        c.whatsapp_template_name ~ '^[a-z0-9_]{1,512}$'
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
$$;

revoke all on function public.claim_campaign_delivery(uuid, uuid, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.claim_campaign_delivery(uuid, uuid, boolean, integer)
  to service_role;
