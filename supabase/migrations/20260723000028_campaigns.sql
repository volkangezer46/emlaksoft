-- SMS / WhatsApp kampanya motoru
-- campaigns: kampanya tanımı
-- campaign_recipients: gönderim kuyruğu + sonuç

create type public.campaign_channel as enum ('sms', 'whatsapp');
create type public.campaign_status  as enum ('draft', 'scheduled', 'sending', 'done', 'failed');
create type public.recipient_status as enum ('pending', 'sent', 'delivered', 'failed', 'opted_out');

create table if not exists public.campaigns (
  id            uuid          primary key default gen_random_uuid(),
  tenant_id     uuid          not null references public.tenants(id) on delete cascade,
  created_by    uuid          references public.profiles(id) on delete set null,
  title         text          not null,
  channel       public.campaign_channel not null default 'sms',
  message       text          not null,
  status        public.campaign_status  not null default 'draft',
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  total_count   int           not null default 0,
  sent_count    int           not null default 0,
  failed_count  int           not null default 0,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

create index if not exists idx_campaigns_tenant
  on public.campaigns(tenant_id, created_at desc);

create table if not exists public.campaign_recipients (
  id            uuid          primary key default gen_random_uuid(),
  campaign_id   uuid          not null references public.campaigns(id) on delete cascade,
  customer_id   uuid          references public.customers(id) on delete set null,
  phone         text          not null,
  full_name     text,
  status        public.recipient_status not null default 'pending',
  error_msg     text,
  sent_at       timestamptz,
  created_at    timestamptz   not null default now()
);

create index if not exists idx_campaign_recipients_campaign
  on public.campaign_recipients(campaign_id, status);

-- RLS
alter table public.campaigns          enable row level security;
alter table public.campaign_recipients enable row level security;

create policy campaigns_tenant on public.campaigns
  using (tenant_id = public.current_tenant_id());

create policy campaigns_tenant_insert on public.campaigns for insert
  with check (tenant_id = public.current_tenant_id());

create policy campaigns_tenant_update on public.campaigns for update
  using (tenant_id = public.current_tenant_id());

create policy campaign_recipients_tenant on public.campaign_recipients
  using (
    campaign_id in (
      select id from public.campaigns where tenant_id = public.current_tenant_id()
    )
  );

create policy campaign_recipients_insert on public.campaign_recipients for insert
  with check (
    campaign_id in (
      select id from public.campaigns where tenant_id = public.current_tenant_id()
    )
  );

-- updated_at trigger
create or replace function public.set_campaigns_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_campaigns_updated_at();

grant all on public.campaigns           to authenticated, service_role;
grant all on public.campaign_recipients to authenticated, service_role;
