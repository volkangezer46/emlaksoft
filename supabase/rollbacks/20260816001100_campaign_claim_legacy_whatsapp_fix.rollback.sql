-- Rollback: 20260816001100_campaign_claim_legacy_whatsapp_fix
-- Claim fonksiyonu 20260731000135 gövdesine, kisit 20260810000920 tanimina doner (eski hata geri gelir).
-- Dikkat: 'failed' yapilan eski WhatsApp kampanyalari bu kisitla UPDATE edilemez; once duzeltilmeleri gerekir.
alter table public.campaigns
  drop constraint if exists campaigns_whatsapp_template_contract;
alter table public.campaigns
  add constraint campaigns_whatsapp_template_contract
  check (
    (
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
  select c.*
    into v_campaign
  from public.campaigns c
  where (p_campaign_id is null or c.id = p_campaign_id)
    and (p_tenant_id is null or c.tenant_id = p_tenant_id)
    and exists (
      select 1 from public.tenants t
      where t.id = c.tenant_id and t.status in ('trial', 'active', 'past_due')
    )
    and (
      (p_force and c.status in ('draft', 'scheduled', 'failed', 'sending'))
      or (
        not p_force
        and (
          (c.status = 'scheduled' and c.scheduled_at is not null and c.scheduled_at <= now())
          or c.status = 'sending'
        )
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
