-- Birleşik iletişim geçmişi tablosu
-- Müşteriyle yapılan tüm iletişimleri (çağrı, WhatsApp, SMS, e-posta, not) tek tabloda tutar.
-- calls tablosundan bağımsız — calls daha detaylı çağrı kaydı için kalır, bu özet/manuel kayıt içindir.

create type public.comm_channel  as enum ('call', 'whatsapp', 'sms', 'email', 'note', 'meeting');
create type public.comm_direction as enum ('inbound', 'outbound', 'internal');

create table if not exists public.communications (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  customer_id   uuid        references public.customers(id) on delete cascade,
  property_id   uuid        references public.properties(id) on delete set null,
  created_by    uuid        references public.profiles(id) on delete set null,
  channel       public.comm_channel   not null default 'note',
  direction     public.comm_direction not null default 'outbound',
  subject       text,          -- e-posta konusu veya kısa özet
  body          text,          -- mesaj içeriği / not
  duration_sec  int,           -- çağrı süresi (sn)
  outcome       text,          -- görüşme sonucu: randevu alındı, geri aranacak, ilgisiz vb.
  scheduled_at  timestamptz,   -- planlanan iletişim zamanı (geçmişte ise gerçekleşti)
  created_at    timestamptz not null default now()
);

create index if not exists idx_communications_customer
  on public.communications(customer_id, created_at desc);

create index if not exists idx_communications_tenant
  on public.communications(tenant_id, created_at desc);

create index if not exists idx_communications_property
  on public.communications(property_id, created_at desc);

-- RLS
alter table public.communications enable row level security;

create policy communications_tenant on public.communications
  using (tenant_id = public.current_tenant_id());

create policy communications_insert on public.communications for insert
  with check (tenant_id = public.current_tenant_id());

create policy communications_update on public.communications for update
  using (tenant_id = public.current_tenant_id());

grant all on public.communications to authenticated, service_role;
