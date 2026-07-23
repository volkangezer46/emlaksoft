-- Inbound lead yakalama: her tenant için public webhook/form token'ı.
-- Web formu, reklam entegrasyonu veya portal lead'leri bu uçtan CRM'e düşer;
-- round-robin ile aktif danışmana atanır (speed-to-lead).

alter table public.tenants
  add column if not exists lead_capture_token text,
  add column if not exists lead_capture_enabled boolean not null default true;

-- Mevcut tenant'lar için token üret
update public.tenants
set lead_capture_token = replace(gen_random_uuid()::text, '-', '')
where lead_capture_token is null;

create unique index if not exists tenants_lead_capture_token_key
  on public.tenants(lead_capture_token) where lead_capture_token is not null;

-- Lead kaynağı ve otomatik atama izini için müşteri kolonları
alter table public.customers
  add column if not exists lead_channel text,
  add column if not exists auto_assigned boolean not null default false;

comment on column public.tenants.lead_capture_token is
  'Public lead yakalama uç noktası token''ı (/api/leads/{token}, /lead/{token})';
comment on column public.customers.lead_channel is
  'Lead giriş kanalı: web_form, webhook, portal, reklam vb.';
