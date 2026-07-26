-- Kullanıcı BAZLI izin istisnaları (rol matrisinin üstüne üçüncü katman).
-- Birleşim sırası: rol varsayılanı (permission_defaults) → tenant rol override'ı
-- (tenant_role_permissions) → KULLANICI override'ı (bu tablo).
--
-- Satır semantiği: bir (tenant, user, module) satırı varsa o modülün etkin aksiyon
-- kümesi TAMAMEN `actions` dizisidir (rolden gelenin yerine geçer).
--   actions = '{}'::text[]  → modül bu kullanıcıya tamamen kapalı.
--   expires_at dolu ve geçmişte → satır YOK sayılır (geçici yetki süresi bitti).
-- Bkz. src/lib/permissions-effective.ts

create table if not exists public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  module text not null,
  actions text[] not null default '{}',
  -- Geçici yetki: dolu ise bu tarihten sonra override yok sayılır.
  expires_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, module)
);

create index if not exists idx_user_permission_overrides_user
  on public.user_permission_overrides(tenant_id, user_id);

comment on table public.user_permission_overrides is
  'Kullanıcıya özel modül izin istisnaları. Satır varsa modülün etkin aksiyonları actions dizisidir; boş dizi = modül kapalı; expires_at geçmişse yok sayılır.';

alter table public.user_permission_overrides enable row level security;

-- Herkes (authenticated) kendi tenant'ının istisnalarını okuyabilir
-- (etkin izin hesaplaması kullanıcının kendi oturumunda yapılır).
create policy user_permission_overrides_read on public.user_permission_overrides for select
  using (tenant_id = public.current_tenant_id());

-- Sadece owner/gm yazabilir (tenant_role_permissions ile aynı desen).
create policy user_permission_overrides_write on public.user_permission_overrides for all
  using (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'))
  with check (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'));

grant select, insert, update, delete on public.user_permission_overrides to authenticated;
grant all on public.user_permission_overrides to service_role;
