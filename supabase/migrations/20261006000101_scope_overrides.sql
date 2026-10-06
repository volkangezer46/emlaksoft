-- Forward-only migration: Scope override'ları (istisna kuralları).
-- Danışman X talep Y'yi görebilir gibi geçici yetkilendirmeler.
-- RLS: Ofis yönetimi yazabilir, authenticated okur.

create table if not exists public.scope_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  resource_type text not null check (
    resource_type in ('demand', 'property', 'portfolio', 'deal', 'commission', 'task', 'report')
  ),
  resource_id uuid not null,
  -- true = ek izin ver, false = izni sınırla
  allowed boolean not null default true,
  -- Yorum: neden bu override verildi
  reason text,
  -- Geçici yetki süresi
  expires_at timestamptz,
  -- Denetim
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  -- resource_type + tenant + user + resource_id kombinasyonu benzersiz; eksires_at geçmiş satırlar yok sayılır
  unique (tenant_id, user_id, resource_type, resource_id)
);

create index if not exists idx_scope_overrides_tenant_user on public.scope_overrides(tenant_id, user_id);
create index if not exists idx_scope_overrides_resource on public.scope_overrides(resource_type, resource_id);
create index if not exists idx_scope_overrides_expires on public.scope_overrides(expires_at)
  where expires_at is not null;

comment on table public.scope_overrides is
  'Kapsam istisnaları. Danışman X talep Y''yi görebilir gibi geçici yetkilendirmeler. Süresi geçmiş satırlar yok sayılır (expires_at < now()).';

comment on column public.scope_overrides.allowed is
  'true = ek erişim izni, false = erişim reddi (geri al)';

comment on column public.scope_overrides.reason is
  'İstisna nedeni (müdür reddetti, geçici atama, vb)';

comment on column public.scope_overrides.expires_at is
  'Süresi dolma tarihi. NULL = sınırsız.';

alter table public.scope_overrides enable row level security;

-- RLS: Authenticated kullanıcı kendi tenant'ının override'larını okur
create policy scope_overrides_read on public.scope_overrides for select
  using (tenant_id = public.current_tenant_id());

-- RLS: Sadece owner/gm yazabilir
create policy scope_overrides_write on public.scope_overrides for all
  using (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'))
  with check (tenant_id = public.current_tenant_id() and public.current_profile_role() in ('owner', 'gm'));

grant select on public.scope_overrides to authenticated;
grant all on public.scope_overrides to service_role;
