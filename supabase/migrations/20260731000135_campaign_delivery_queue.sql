-- Profesyonel kampanya teslimat kuyruğu
--
-- Kampanyalar artık küçük partiler halinde, tek bir worker tarafından ve
-- çakışan cron/manual isteklerinde çift gönderim üretmeden işlenir. Lease
-- süresi dolan işler otomatik olarak başka bir worker tarafından devralınır.

alter table public.campaigns
  add column if not exists processing_token uuid,
  add column if not exists processing_started_at timestamptz,
  add column if not exists last_error text;

create index if not exists idx_campaigns_due_delivery
  on public.campaigns (scheduled_at, created_at)
  where status = 'scheduled';

create index if not exists idx_campaigns_resumable_delivery
  on public.campaigns (processing_started_at, created_at)
  where status = 'sending';

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

comment on function public.claim_campaign_delivery(uuid, uuid, boolean, integer) is
  'Kampanya teslimatını atomik olarak sahiplenir; yalnız service_role çağırabilir.';

-- Liste sayfası son 50 satırı gösterse bile KPI'lar bütün tenant verisini
-- yansıtmalıdır. Bu özet RLS/current_tenant_id sınırı içinde tek sorguda döner.
create or replace function public.get_campaign_overview()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'total', count(*)::integer,
    'done', count(*) filter (where status = 'done'),
    'sending', count(*) filter (where status = 'sending'),
    'scheduled', count(*) filter (where status = 'scheduled'),
    'failed', count(*) filter (where status = 'failed'),
    'sent_messages', coalesce(sum(sent_count), 0)::bigint,
    'failed_messages', coalesce(sum(failed_count), 0)::bigint,
    'sms_count', count(*) filter (where channel = 'sms'),
    'sms_sent', coalesce(sum(sent_count) filter (where channel = 'sms'), 0)::bigint,
    'whatsapp_count', count(*) filter (where channel = 'whatsapp'),
    'whatsapp_sent', coalesce(sum(sent_count) filter (where channel = 'whatsapp'), 0)::bigint,
    'email_count', count(*) filter (where channel = 'email'),
    'email_sent', coalesce(sum(sent_count) filter (where channel = 'email'), 0)::bigint
  )
  from public.campaigns
  where tenant_id = public.current_tenant_id();
$$;

revoke all on function public.get_campaign_overview() from public, anon;
grant execute on function public.get_campaign_overview() to authenticated, service_role;
