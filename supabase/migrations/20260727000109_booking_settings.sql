-- ============================================================
-- Online randevu (danışmanın takvim linki) — /randevu-al/[token]
-- ============================================================
-- Danışman kendi rezervasyon linkini müşteriye WhatsApp'tan gönderir; müşteri
-- müsait saatlerden birini seçip randevu alır. Randevu `appointments` tablosuna
-- (assigned_to = danışman) düşer ve danışmana bildirim gider.
--
-- Public sayfa token'ı service role ile çözer (surveys/open_houses public_token
-- deseni) — RLS anon'a AÇILMAZ.

create table if not exists public.booking_settings (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  -- Ayar kişiye özel: her danışmanın kendi linki ve kendi çalışma saatleri var.
  staff_id       uuid        not null references public.profiles(id) on delete cascade,
  public_token   uuid        not null unique default gen_random_uuid(),
  -- Varsayılan KAPALI: danışman saatlerini girmeden link canlıya çıkmasın.
  is_active      boolean     not null default false,
  -- {"1":["09:00","18:00"], "2":[...]} — pazartesi=1 … pazar=7. Eksik/boş gün KAPALI.
  weekday_hours  jsonb       not null default '{}'::jsonb,
  slot_minutes   int         not null default 60  check (slot_minutes between 10 and 480),
  buffer_minutes int         not null default 0   check (buffer_minutes between 0 and 240),
  max_days_ahead int         not null default 14  check (max_days_ahead between 1 and 90),
  min_hours_notice int       not null default 4   check (min_hours_notice between 0 and 168),
  -- Public sayfada müşteriye gösterilen serbest not (buluşma noktası, uyarı vb.)
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.booking_settings is
  'Danışman bazlı online randevu ayarı (/randevu-al/[token]) — çalışma saatleri, slot süresi, public token';
comment on column public.booking_settings.weekday_hours is
  'Hafta günü → [başlangıç, bitiş] saatleri. Pazartesi=1 … Pazar=7. Gün yoksa o gün kapalı.';
comment on column public.booking_settings.public_token is
  'Public rezervasyon sayfası için tahmin edilemez token (surveys deseni); "Linki yenile" yeni uuid üretir';
comment on column public.booking_settings.buffer_minutes is
  'Mevcut randevuların önüne/arkasına eklenen tampon — bu kadar dakika içindeki slotlar dolu sayılır';
comment on column public.booking_settings.min_hours_notice is
  'Müşteri en az bu kadar saat sonrası için randevu alabilir (son dakika rezervasyonunu engeller)';

-- Bir danışmanın kiracı içinde TEK ayarı olur — upsert bu kısıta dayanır.
create unique index if not exists idx_booking_settings_staff_unique
  on public.booking_settings(tenant_id, staff_id);

-- Panel tarafı: kiracının aktif linklerini listelemek için.
create index if not exists idx_booking_settings_tenant
  on public.booking_settings(tenant_id, is_active);

-- ============================================================
-- RLS — kiracı izolasyonu (bkz. 20260725000054: helper kullan)
-- ============================================================
alter table public.booking_settings enable row level security;

drop policy if exists booking_settings_tenant on public.booking_settings;
create policy booking_settings_tenant on public.booking_settings
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy booking_settings_tenant on public.booking_settings is
  'Kiracı izolasyonu — current_tenant_id(). Public rezervasyon sayfası service role ile okur.';

grant all on public.booking_settings to authenticated, service_role;
