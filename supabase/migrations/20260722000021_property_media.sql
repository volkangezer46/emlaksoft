-- Portföy medya galerisi: fotoğraf, video ve 360° sanal tur bağlantıları.
-- Rakiplerde (EmlakCRM, Rapitek) standart olan zengin medya sunumu.

create table if not exists public.property_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null default 'image' check (kind in ('image', 'video', 'tour')),
  storage_path text,          -- image/video için storage yolu
  external_url text,          -- video/tur için harici URL (YouTube, Matterport vb.)
  file_name text,
  file_type text,
  file_size bigint,
  is_cover boolean not null default false,
  sort_order int not null default 0,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_property_media_property
  on public.property_media(tenant_id, property_id, sort_order);

alter table public.property_media enable row level security;

drop policy if exists property_media_tenant on public.property_media;
create policy property_media_tenant on public.property_media for all
  using (tenant_id = (select auth.jwt()->>'tenant_id')::uuid);

grant all on public.property_media to authenticated, service_role;

-- Depolama alanı (private; sunum admin/route üzerinden yapılır)
insert into storage.buckets (id, name, public)
values ('property-media', 'property-media', false)
on conflict (id) do nothing;

comment on table public.property_media is
  'Portföy medya galerisi: fotoğraf (storage), video/360 tur (harici URL veya storage)';
