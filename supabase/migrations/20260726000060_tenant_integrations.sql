-- Tenant bazlı entegrasyon kimlik bilgileri (Netgsm vb.).
-- Kampanya gönderimi bugün platform_settings/env'den okuyor (src/lib/messaging/netgsm.ts);
-- bu tablo ofis başına kimlik bilgisi saklamak için — gönderim yolu tenant kaydı varsa
-- onu tercih edecek şekilde ayrıca bağlanmalı. Kayıt yoksa davranış değişmez.
create table if not exists public.tenant_integrations (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  provider    text        not null,                    -- 'netgsm', 'whatsapp', ...
  credentials jsonb       not null default '{}'::jsonb, -- ör. {"usercode":"...","password":"...","msgheader":"..."}
  is_active   boolean     not null default true,
  updated_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, provider)
);

create index if not exists idx_tenant_integrations_tenant
  on public.tenant_integrations (tenant_id, provider) where is_active;

alter table public.tenant_integrations enable row level security;

-- Ofis yalnızca kendi entegrasyon kayıtlarını görür/yönetir
create policy tenant_integrations_read on public.tenant_integrations for select
  using (tenant_id = public.current_tenant_id());
create policy tenant_integrations_insert on public.tenant_integrations for insert
  with check (tenant_id = public.current_tenant_id());
create policy tenant_integrations_update on public.tenant_integrations for update
  using (tenant_id = public.current_tenant_id());
create policy tenant_integrations_delete on public.tenant_integrations for delete
  using (tenant_id = public.current_tenant_id());

grant all on public.tenant_integrations to authenticated, service_role;
