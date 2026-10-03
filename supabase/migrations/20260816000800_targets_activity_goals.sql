-- Faz 2 / 08: targets genişletme — randevu / portföy / talep hedefi.
--
-- NEDEN: targets yalnız anlaşma ve ciro hedefi taşıyor (belge 1B/3d). Ayrı `advisor_targets` tablosu
-- AÇILMAZ (mükerrer olur); mevcut tablo genişler. profile_id zaten var (null = ofis hedefi).
-- Gerçekleşme: actual_deals/actual_revenue sütunları DOKUNULMAZ (okunmuyor; karar ayrı). Yeni hedefler için
-- actual_* sütunu EKLENMEZ: gerçekleşme canlı veriden hesaplanır (src/lib/team/target-actuals.ts deseni).
-- RLS: tablo zaten RLS'li; sütun eklemek politikaları değiştirmez. Mevcut politikalar tenant kapsamlıdır.
-- GERİ ALMA: rollbacks/20260816000800_targets_activity_goals.rollback.sql (3 sütun düşer).
-- RİSK: çok düşük (NOT NULL DEFAULT 0 sabit varsayılan; mevcut insert/upsert'ler etkilenmez).

alter table public.targets
  add column if not exists target_appointments integer not null default 0
    check (target_appointments >= 0),
  add column if not exists target_listings integer not null default 0
    check (target_listings >= 0),
  add column if not exists target_demands integer not null default 0
    check (target_demands >= 0);

create index if not exists idx_targets_profile_period
  on public.targets (tenant_id, profile_id, period_start desc);

comment on column public.targets.target_appointments is 'Dönem randevu hedefi (gerçekleşme canlı veriden).';
comment on column public.targets.target_listings is 'Dönem yeni portföy (ilan) hedefi (gerçekleşme canlı veriden).';
comment on column public.targets.target_demands is 'Dönem yeni talep hedefi (gerçekleşme canlı veriden).';
