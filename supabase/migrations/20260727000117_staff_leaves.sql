-- ============================================================
-- Ekip izin & müsaitlik takvimi — staff_leaves
-- ============================================================
-- Neden:
--  * Dalga P'de online randevu rezervasyonu (`booking_settings`, /randevu-al/[token])
--    açıldı. Danışman izne çıktığında müşteri hâlâ o günlere randevu alabiliyordu —
--    ofis "kim izinde?" bilgisini hiçbir yerde tutmadığı için sistem bunu bilemiyordu.
--  * Bu tablo tek doğruluk kaynağı: hem /app/ekip/izinler takvimi hem de public
--    randevu slot üretimi (onaylı izinler o günü tamamen bloklar) buradan okur.
--
-- Tasarım kararları:
--  * starts_on/ends_on DATE (timestamptz değil): izin gün bazlıdır ("14-18 Ağustos"),
--    saat bilgisi yok. İki uç DAHİLDİR (inclusive) — 14-14 tek günlük izindir.
--    Saat dilimi tartışması da böylece hiç doğmaz; slot tarafı TR duvar gününe çevirir.
--  * kind/status text + check (enum değil): sabit küçük kümeler; enum ADD VALUE +
--    kullanım aynı migration'da olamadığı için (087/087b deseni) text daha ucuz.
--  * status default 'onayli': yönetici kendi eklediğini doğrudan onaylı yazar;
--    danışmanın kendi adına açtığı kayıt uygulama katmanında 'talep' ile gelir.
--    'reddedildi' satırı SİLİNMEZ — izin geçmişi/denetim izi korunur, ama hiçbir
--    yerde bloklama yapmaz (yalnız 'onayli' busy sayılır).
--  * CHECK ends_on >= starts_on: ters aralık DB seviyesinde imkânsız.

create table if not exists public.staff_leaves (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  staff_id   uuid        not null references public.profiles(id) on delete cascade,
  starts_on  date        not null,
  ends_on    date        not null,
  kind       text        not null default 'izin'
                         check (kind in ('izin', 'rapor', 'egitim', 'resmi_tatil', 'diger')),
  note       text,
  status     text        not null default 'onayli'
                         check (status in ('talep', 'onayli', 'reddedildi')),
  created_by uuid        references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint staff_leaves_range_check check (ends_on >= starts_on)
);

comment on table  public.staff_leaves            is 'Personel izin/rapor kayıtları — ekip müsaitlik takvimi ve online randevu slot bloklaması';
comment on column public.staff_leaves.starts_on  is 'İzin başlangıç günü (dahil)';
comment on column public.staff_leaves.ends_on    is 'İzin bitiş günü (DAHİL) — tek günlük izinde starts_on ile aynıdır';
comment on column public.staff_leaves.kind       is 'izin | rapor | egitim | resmi_tatil | diger — UI rozet rengi bu değerden türer';
comment on column public.staff_leaves.status     is 'talep (onay bekliyor) | onayli (bloklar) | reddedildi (arşiv, bloklamaz)';
comment on column public.staff_leaves.created_by is 'Kaydı açan profil — kullanıcı silinirse null kalır';

-- Takvim/slot sorgusunun tam deseni: tenant + kişi + tarih aralığı.
create index if not exists idx_staff_leaves_tenant_staff_start
  on public.staff_leaves(tenant_id, staff_id, starts_on);

-- Ay ızgarası tüm ekibi tek sorguda çeker (kişi filtresi yok).
create index if not exists idx_staff_leaves_tenant_range
  on public.staff_leaves(tenant_id, starts_on, ends_on);

-- ============================================================
-- RLS — kiracı izolasyonu (bkz. 20260725000054: helper kullan)
-- ============================================================
alter table public.staff_leaves enable row level security;

drop policy if exists staff_leaves_tenant on public.staff_leaves;
create policy staff_leaves_tenant on public.staff_leaves
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy staff_leaves_tenant on public.staff_leaves is
  'Kiracı izolasyonu — current_tenant_id(). Kişi bazlı kısıt (kendi izni / onay yetkisi) uygulama katmanında requirePermission ile.';

grant all on public.staff_leaves to authenticated, service_role;
