-- P1-3: Portföy durum geçmişi
-- P1-4: Portal yayın UI için gerekli alanlar (zaten var, sadece index)
-- P1-5: Yetki belgesi takibi
-- P1-6: Seçimli alanlar tanım tabloları

-- ============================================================
-- P1-3: Portföy durum geçmişi
-- ============================================================
create table if not exists public.property_status_history (
  id            uuid        primary key default gen_random_uuid(),
  property_id   uuid        not null references public.properties(id) on delete cascade,
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  old_status    text,
  new_status    text        not null,
  reason        text,
  changed_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_prop_status_history_property
  on public.property_status_history(property_id, created_at desc);

alter table public.property_status_history enable row level security;

create policy prop_status_history_tenant on public.property_status_history
  using (tenant_id = public.current_tenant_id());

create policy prop_status_history_insert on public.property_status_history for insert
  with check (tenant_id = public.current_tenant_id());

grant all on public.property_status_history to authenticated, service_role;

-- ============================================================
-- P1-5: Yetki belgesi alanları (properties tablosuna ekle)
-- ============================================================
alter table public.properties
  add column if not exists authorization_start date,
  add column if not exists authorization_end   date,
  add column if not exists authorization_type  text,  -- 'exclusive', 'open', 'limited'
  add column if not exists authorization_notes text;

comment on column public.properties.authorization_start is 'Yetki belgesi başlangıç tarihi';
comment on column public.properties.authorization_end   is 'Yetki belgesi bitiş tarihi';
comment on column public.properties.authorization_type  is 'Yetki tipi: exclusive (tek), open (açık), limited (sınırlı)';

-- ============================================================
-- P1-6: Seçimli alanlar tanım tablosu (genel amaçlı lookup)
-- ============================================================
create table if not exists public.lookup_values (
  id          uuid    primary key default gen_random_uuid(),
  tenant_id   uuid    references public.tenants(id) on delete cascade,  -- null = sistem geneli
  category    text    not null,   -- 'property_type', 'transaction_type', 'heating_type', vb.
  value       text    not null,
  label       text    not null,
  sort_order  int     not null default 0,
  is_active   boolean not null default true,
  is_system   boolean not null default false,  -- sistem tarafından eklendi, silinemez
  created_at  timestamptz not null default now(),
  unique (tenant_id, category, value)
);

create index if not exists idx_lookup_values_category
  on public.lookup_values(category, sort_order);

alter table public.lookup_values enable row level security;

-- Herkes okuyabilir (sistem geneli + kendi tenant'ı)
create policy lookup_values_read on public.lookup_values for select
  using (tenant_id is null or tenant_id = public.current_tenant_id());

-- Sadece kendi tenant'ına yazabilir
create policy lookup_values_insert on public.lookup_values for insert
  with check (tenant_id = public.current_tenant_id());

create policy lookup_values_update on public.lookup_values for update
  using (tenant_id = public.current_tenant_id() and is_system = false);

create policy lookup_values_delete on public.lookup_values for delete
  using (tenant_id = public.current_tenant_id() and is_system = false);

grant all on public.lookup_values to authenticated, service_role;

-- Sistem geneli varsayılan değerleri ekle
insert into public.lookup_values (tenant_id, category, value, label, sort_order, is_system) values
  -- Portföy türleri
  (null, 'property_type', 'daire',         'Daire',           10, true),
  (null, 'property_type', 'villa',          'Villa',           20, true),
  (null, 'property_type', 'mustakil',       'Müstakil Ev',     30, true),
  (null, 'property_type', 'rezidans',       'Rezidans',        40, true),
  (null, 'property_type', 'yazlik',         'Yazlık',          50, true),
  (null, 'property_type', 'arsa',           'Arsa',            60, true),
  (null, 'property_type', 'tarla',          'Tarla',           70, true),
  (null, 'property_type', 'ofis',           'Ofis',            80, true),
  (null, 'property_type', 'dukkan',         'Dükkan',          90, true),
  (null, 'property_type', 'depo',           'Depo',           100, true),
  (null, 'property_type', 'fabrika',        'Fabrika',        110, true),
  (null, 'property_type', 'otel',           'Otel',           120, true),
  (null, 'property_type', 'diger',          'Diğer',          999, true),
  -- İşlem türleri
  (null, 'transaction_type', 'satilik',     'Satılık',         10, true),
  (null, 'transaction_type', 'kiralik',     'Kiralık',         20, true),
  (null, 'transaction_type', 'devren',      'Devren',          30, true),
  (null, 'transaction_type', 'gunluk',      'Günlük Kiralık',  40, true),
  -- Isınma türleri
  (null, 'heating_type', 'dogalgaz',        'Doğalgaz',        10, true),
  (null, 'heating_type', 'kombi',           'Kombi (Doğalgaz)',20, true),
  (null, 'heating_type', 'merkezi',         'Merkezi Sistem',  30, true),
  (null, 'heating_type', 'soba',            'Soba',            40, true),
  (null, 'heating_type', 'klima',           'Klima',           50, true),
  (null, 'heating_type', 'yerden_isitma',   'Yerden Isıtma',   60, true),
  (null, 'heating_type', 'yok',             'Isıtma Yok',      70, true),
  -- Portföy durumları
  (null, 'property_status', 'draft',        'Taslak',          10, true),
  (null, 'property_status', 'pending_docs', 'Evrak Bekliyor',  20, true),
  (null, 'property_status', 'pending_auth', 'Yetki Bekliyor',  30, true),
  (null, 'property_status', 'photo_needed', 'Fotoğraf Çekilecek', 40, true),
  (null, 'property_status', 'ready',        'Yayına Hazır',    50, true),
  (null, 'property_status', 'active',       'Aktif',           60, true),
  (null, 'property_status', 'passive',      'Pasif',           70, true),
  (null, 'property_status', 'reserved',     'Rezerve',         80, true),
  (null, 'property_status', 'deposit',      'Kapora Alındı',   90, true),
  (null, 'property_status', 'in_progress',  'Süreçte',        100, true),
  (null, 'property_status', 'sold',         'Satıldı',        110, true),
  (null, 'property_status', 'rented',       'Kiralandı',      120, true),
  (null, 'property_status', 'withdrawn',    'Vazgeçildi',     130, true),
  (null, 'property_status', 'auth_expired', 'Yetki Süresi Doldu', 140, true),
  -- Oda sayıları
  (null, 'room_count', '1+0',   'Stüdyo',   10, true),
  (null, 'room_count', '1+1',   '1+1',      20, true),
  (null, 'room_count', '2+1',   '2+1',      30, true),
  (null, 'room_count', '3+1',   '3+1',      40, true),
  (null, 'room_count', '4+1',   '4+1',      50, true),
  (null, 'room_count', '5+1',   '5+1',      60, true),
  (null, 'room_count', '5+',    '5+ Oda',   70, true),
  -- Cephe
  (null, 'facade', 'kuzey',     'Kuzey',    10, true),
  (null, 'facade', 'guney',     'Güney',    20, true),
  (null, 'facade', 'dogu',      'Doğu',     30, true),
  (null, 'facade', 'bati',      'Batı',     40, true),
  (null, 'facade', 'kuzey_guney','Kuzey-Güney', 50, true),
  (null, 'facade', 'dogu_bati', 'Doğu-Batı', 60, true),
  -- Yetki türleri
  (null, 'authorization_type', 'exclusive', 'Tek Yetkili', 10, true),
  (null, 'authorization_type', 'open',      'Açık Yetki',  20, true),
  (null, 'authorization_type', 'limited',   'Sınırlı Yetki', 30, true)
on conflict (tenant_id, category, value) do nothing;
