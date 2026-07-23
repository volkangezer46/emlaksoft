-- Platform seviyesi anahtar-değer ayarları (EmlakSoft yönetimi).
-- OpenAI API anahtarı gibi entegrasyon sırlarını UI'dan yönetmek için.
-- Sadece platform staff erişebilir; okuma/yazma service_role veya super_admin üzerinden yapılır.

create table if not exists public.platform_settings (
  key text primary key,
  value text,
  updated_by uuid references public.platform_staff(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

-- Not: hassas anahtarların (openai_api_key) client'a düşmemesi için okuma da service_role
-- üzerinden yapılır. RLS yalnızca super_admin'e doğrudan erişim verir.
drop policy if exists platform_settings_super_admin on public.platform_settings;
create policy platform_settings_super_admin on public.platform_settings
  for all
  using (
    exists (
      select 1 from public.platform_staff s
      where s.id = auth.uid() and s.is_active and s.role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.platform_staff s
      where s.id = auth.uid() and s.is_active and s.role = 'super_admin'
    )
  );

grant select, insert, update, delete on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;

comment on table public.platform_settings is
  'Platform anahtar-değer ayarları (OpenAI vb. entegrasyon sırları). Okuma service_role ile.';
