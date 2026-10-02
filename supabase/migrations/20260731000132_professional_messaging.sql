-- Profesyonel omnichannel altyapısı
-- - kampanyalarda gerçek e-posta alıcısı
-- - provider message/delivery kimliği
-- - WhatsApp/Netgsm hesabını doğru tenant'a bağlayan public hesap kimliği
-- - webhook idempotency + retry/replay için kalıcı inbox

alter type public.campaign_channel add value if not exists 'email';

alter table public.campaign_recipients
  alter column phone drop not null,
  add column if not exists email text,
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

alter table public.campaign_recipients
  drop constraint if exists campaign_recipient_has_address;
alter table public.campaign_recipients
  add constraint campaign_recipient_has_address
  check (nullif(trim(coalesce(phone, '')), '') is not null or nullif(trim(coalesce(email, '')), '') is not null)
  not valid;
alter table public.campaign_recipients validate constraint campaign_recipient_has_address;

create index if not exists idx_campaign_recipients_provider_message
  on public.campaign_recipients(provider, provider_message_id)
  where provider is not null and provider_message_id is not null;

alter table public.communications
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists delivery_status text,
  add column if not exists contact_address text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz;

create unique index if not exists uq_communications_provider_message
  on public.communications(tenant_id, provider, provider_message_id)
  where provider is not null and provider_message_id is not null;

alter table public.tenant_integrations
  add column if not exists external_account_id text,
  add column if not exists connection_status text not null default 'configured',
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_error text;

alter table public.tenant_integrations
  drop constraint if exists tenant_integrations_connection_status_check;
alter table public.tenant_integrations
  add constraint tenant_integrations_connection_status_check
  check (connection_status in ('configured', 'healthy', 'degraded', 'disabled'));

create unique index if not exists uq_tenant_integrations_external_account
  on public.tenant_integrations(provider, external_account_id)
  where external_account_id is not null and is_active;

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  tenant_id uuid references public.tenants(id) on delete set null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'ignored', 'unmatched', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  error_message text,
  received_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (provider, provider_event_id)
);

create index if not exists idx_webhook_events_queue
  on public.webhook_events(status, received_at)
  where status in ('received', 'failed');
create index if not exists idx_webhook_events_tenant
  on public.webhook_events(tenant_id, received_at desc);
create index if not exists idx_webhook_events_expiry
  on public.webhook_events(expires_at);

alter table public.webhook_events enable row level security;
revoke all on table public.webhook_events from public, anon, authenticated;
grant all on table public.webhook_events to service_role;

comment on table public.webhook_events is
  'Provider webhook idempotency, gözlem, retry ve replay inbox. Ham payload 30 gün sonra temizlenmelidir.';
comment on column public.tenant_integrations.external_account_id is
  'Gizli olmayan provider hesabı: WhatsApp phone_number_id veya Netgsm inbound receiver/shortcode.';
