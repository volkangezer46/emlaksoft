-- DB-driven tanımlar (dropdown/seçim alanları). tenant_id null = tüm ofisler için
-- global varsayılan; bir ofis kendi tenant_id'siyle override/ekleme yapabilir.
create table if not exists public.definitions (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        references public.tenants(id) on delete cascade,
  category    text        not null,   -- 'customer_type','customer_source','property_type',...
  value       text        not null,   -- saklanan değer
  label       text        not null,   -- görünen etiket
  color       text,                   -- opsiyonel rozet rengi
  sort_order  int         not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- Aynı ofiste (veya global) aynı kategori+değer tekilliği
create unique index if not exists uq_definitions_scope
  on public.definitions (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), category, value);
create index if not exists idx_definitions_lookup
  on public.definitions (category, tenant_id) where is_active;

alter table public.definitions enable row level security;

-- Ofis kendi tanımlarını + global (tenant_id null) tanımları OKUR
create policy definitions_read on public.definitions for select
  using (tenant_id is null or tenant_id = public.current_tenant_id());
-- Ofis yalnızca KENDİ tanımlarını yazabilir (global'leri değil)
create policy definitions_insert on public.definitions for insert
  with check (tenant_id = public.current_tenant_id());
create policy definitions_update on public.definitions for update
  using (tenant_id = public.current_tenant_id());
create policy definitions_delete on public.definitions for delete
  using (tenant_id = public.current_tenant_id());

grant all on public.definitions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Global varsayılan tanımlar (tenant_id null) — mevcut sabit-kodlu değerler
-- ---------------------------------------------------------------------------
insert into public.definitions (tenant_id, category, value, label, sort_order) values
  -- Müşteri tipi
  (null, 'customer_type', 'Alıcı', 'Alıcı', 1),
  (null, 'customer_type', 'Satıcı', 'Satıcı', 2),
  (null, 'customer_type', 'Kiracı', 'Kiracı', 3),
  (null, 'customer_type', 'Mülk sahibi', 'Mülk sahibi', 4),
  (null, 'customer_type', 'Yatırımcı', 'Yatırımcı', 5),
  -- Müşteri kaynağı
  (null, 'customer_source', 'referral', 'Referans', 1),
  (null, 'customer_source', 'web', 'Web sitesi', 2),
  (null, 'customer_source', 'social', 'Sosyal medya', 3),
  (null, 'customer_source', 'walk_in', 'Elden geldi', 4),
  (null, 'customer_source', 'phone', 'Telefon', 5),
  (null, 'customer_source', 'portal', 'Portal', 6),
  (null, 'customer_source', 'other', 'Diğer', 7),
  -- Portföy tipi
  (null, 'property_type', 'Daire', 'Daire', 1),
  (null, 'property_type', 'Villa', 'Villa', 2),
  (null, 'property_type', 'Müstakil ev', 'Müstakil ev', 3),
  (null, 'property_type', 'Arsa', 'Arsa', 4),
  (null, 'property_type', 'İşyeri', 'İşyeri', 5),
  (null, 'property_type', 'Dükkan', 'Dükkan', 6),
  (null, 'property_type', 'Ofis', 'Ofis', 7),
  (null, 'property_type', 'Depo', 'Depo', 8),
  (null, 'property_type', 'Bina', 'Bina', 9),
  -- İşlem tipi
  (null, 'transaction_type', 'Satılık', 'Satılık', 1),
  (null, 'transaction_type', 'Kiralık', 'Kiralık', 2),
  -- Sözleşme tipi
  (null, 'contract_type', 'satis', 'Satış', 1),
  (null, 'contract_type', 'kira', 'Kira', 2),
  (null, 'contract_type', 'sozlesme', 'Sözleşme', 3),
  (null, 'contract_type', 'teklif', 'Teklif', 4),
  (null, 'contract_type', 'diger', 'Diğer', 5)
on conflict do nothing;
