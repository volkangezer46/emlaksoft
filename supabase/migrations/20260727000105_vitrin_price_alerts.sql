-- Vitrin fiyat alarmı: "Fiyat düşünce haber ver" kayıtları
--
-- ============================================================================
-- NEDEN
-- ============================================================================
-- Vitrin ilan detayında ziyaretçi ad + telefon + KVKK onayı bırakır; fiyat
-- düştüğünde ziyaretçiye SMS GÖNDERİLMEZ (maliyet + İYS) — günlük cron
-- (/api/cron/vitrin-alarm) güncel fiyatı alarmın kurulduğu andaki fiyatla
-- (baseline_price) karşılaştırır ve düşüş varsa OFİSE "araması için" bildirim
-- yazar (notified_at doldurulur, tek seferlik).
--
-- baseline_price YAKLAŞIMI: projede price_history tablosu yok; fiyat düşüşünü
-- güvenilir tespit etmenin tek yolu alarm anındaki liste fiyatını satırda
-- saklamak. Cron'da güncel list_price < baseline_price ise düşüş kabul edilir.
--
-- Yazma yalnızca service_role üzerinden (public action + cron admin client).
-- Tenant kullanıcıları kendi satırlarını okuyabilir (RLS select) — panelde
-- "kim alarm kurdu" listelenebilir olsun.

create table if not exists public.vitrin_price_alerts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  property_id    uuid not null references public.properties(id) on delete cascade,
  -- Ziyaretçi adı (opsiyonel — form zorlamaz)
  name           text,
  -- 05XXXXXXXXX normalize edilmiş cep telefonu (lib/phone standardı)
  phone          text not null,
  -- Alarmın kurulduğu andaki liste fiyatı — cron bunun altına düşüşü arar
  baseline_price numeric not null,
  -- KVKK onay anı — onay kutusu işaretlenmeden kayıt oluşmaz
  kvkk_at        timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  -- Cron ofise "fiyat düştü, arayın" bildirimini yazdığı an (tek seferlik fren)
  notified_at    timestamptz
);

create index if not exists idx_vitrin_price_alerts_tenant
  on public.vitrin_price_alerts(tenant_id, created_at desc);
create index if not exists idx_vitrin_price_alerts_pending
  on public.vitrin_price_alerts(property_id) where notified_at is null;

alter table public.vitrin_price_alerts enable row level security;

drop policy if exists vitrin_price_alerts_tenant_read on public.vitrin_price_alerts;
create policy vitrin_price_alerts_tenant_read on public.vitrin_price_alerts
  for select
  using (tenant_id = public.current_tenant_id());

grant select on public.vitrin_price_alerts to authenticated;
grant all on public.vitrin_price_alerts to service_role;

comment on table public.vitrin_price_alerts is
  'Vitrin fiyat alarmi (KVKK onayli): fiyat baseline altina dusunce cron ofise bildirir.';
