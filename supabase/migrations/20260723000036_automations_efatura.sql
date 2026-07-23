-- Otomasyon motoru: kural tabanlı tetikleyici → aksiyon sistemi

create type public.automation_trigger as enum (
  'new_customer',       -- Yeni müşteri oluşturuldu
  'new_demand',         -- Yeni talep oluşturuldu
  'new_property',       -- Yeni portföy eklendi
  'property_matched',   -- Portföy-müşteri eşleşmesi
  'no_contact_days',    -- X gündür iletişim yok
  'offer_received',     -- Teklif alındı
  'deal_won',           -- Satış tamamlandı
  'deal_lost',          -- Satış kaybedildi
  'auth_expiring',      -- Yetki belgesi dolmak üzere
  'appointment_missed', -- Randevu kaçırıldı
  'demand_stale'        -- X gündür hareketsiz talep
);

create type public.automation_action as enum (
  'send_whatsapp',      -- WhatsApp mesajı gönder
  'send_sms',           -- SMS gönder
  'create_task',        -- Görev oluştur
  'assign_to_staff',    -- Danışmana ata
  'notify_manager',     -- Müdüre bildirim gönder
  'add_tag',            -- Müşteriye etiket ekle
  'change_status',      -- Durum değiştir
  'send_notification'   -- Uygulama içi bildirim
);

create type public.automation_status as enum ('active', 'inactive', 'draft');

create table if not exists public.automations (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  created_by    uuid        references public.profiles(id) on delete set null,
  name          text        not null,
  description   text,
  trigger_type  public.automation_trigger not null,
  trigger_config jsonb      not null default '{}',  -- {days: 14, status: "active"} vb.
  conditions    jsonb       not null default '[]',  -- [{field, op, value}]
  actions       jsonb       not null default '[]',  -- [{type, config}]
  status        public.automation_status not null default 'draft',
  run_count     int         not null default 0,
  last_run_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_automations_tenant
  on public.automations(tenant_id, status);

create table if not exists public.automation_logs (
  id              uuid        primary key default gen_random_uuid(),
  automation_id   uuid        not null references public.automations(id) on delete cascade,
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  entity_type     text,
  entity_id       uuid,
  actions_taken   jsonb,
  result          text        not null default 'ok', -- 'ok' | 'skip' | 'error'
  error_msg       text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_automation_logs_automation
  on public.automation_logs(automation_id, created_at desc);

alter table public.automations      enable row level security;
alter table public.automation_logs  enable row level security;

create policy automations_tenant on public.automations
  using (tenant_id = public.current_tenant_id());
create policy automations_insert on public.automations for insert
  with check (tenant_id = public.current_tenant_id());
create policy automations_update on public.automations for update
  using (tenant_id = public.current_tenant_id());

create policy automation_logs_tenant on public.automation_logs
  using (tenant_id = public.current_tenant_id());

grant all on public.automations     to authenticated, service_role;
grant all on public.automation_logs to authenticated, service_role;

-- E-fatura entegrasyon ayarları (platform_settings'e eklenir)
-- efatura_provider: 'logo', 'mikro', 'parasutu', 'luca', 'netsis', 'custom'
-- efatura_api_url, efatura_api_key, efatura_company_tax_no girilir
-- Şimdilik iskelet — gerçek entegrasyon gelecek sprint
