-- AD3 Tahsilat politikasi: dunning olay gunlugu (kademe x kanal x sonuc).
--
-- Yazan: /api/cron/dunning (service_role). Okuyan: /admin/billing/tahsilat (kurtarma raporu) ve Ofis 360 zaman cizelgesi.
-- Kisisel veri saklanmaz (alici adresi/telefonu YOK; yalniz kanal ve sonuc).
-- (invoice_id, stage, channel) benzersizdir: ayni fatura+kademe+kanal icin ikinci gonderim yapilmaz (cron "talep" satirini
--   once yazar, sonra gonderir; cakisirsa gondermez).
-- RLS acik, politika yok -> anon/authenticated hicbir sey goremez; erisim yalniz service_role (perf_lab_runs deseni).
-- platform_settings anahtarlari (tablo degisikligi YOK, kod yazar): dunning.* (src/lib/settings/registry/dunning.ts).
-- KOD DAVRANISI: tablo yokken cron yalniz uygulama ici bildirimi gonderir (bugunku davranis), e-posta/SMS kademeleri atlanir;
--   rapor ve zaman cizelgesi "gunluk yok" gosterir.
-- GERI ALMA: supabase/rollbacks/20261013004200_dunning_events.rollback.sql (yalniz tahsilat gunlugu silinir).
-- RISK: dusuk (yeni tablo; mevcut tablo/politika/yetkilere dokunmaz).

create table if not exists public.dunning_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  stage text not null check (stage in ('stage1', 'stage2', 'stage3', 'final_warning', 'suspend', 'candidate')),
  channel text not null check (channel in ('in_app', 'email', 'sms', 'staff', 'system')),
  result text not null check (result in ('pending', 'sent', 'channel_disabled', 'no_recipient', 'failed', 'suspended')),
  detail text check (detail is null or char_length(detail) <= 300),
  sent_at timestamptz not null default now(),
  constraint dunning_events_invoice_stage_channel_key unique (invoice_id, stage, channel)
);

create index if not exists dunning_events_tenant_sent_idx on public.dunning_events (tenant_id, sent_at desc);
create index if not exists dunning_events_sent_idx on public.dunning_events (sent_at desc);

alter table public.dunning_events enable row level security;
-- Politika bilerek yok: anon/authenticated hicbir sey goremez; service_role RLS'i atlar.
revoke all on table public.dunning_events from public, anon, authenticated;
grant select, insert, update, delete on table public.dunning_events to service_role;
revoke all on sequence public.dunning_events_id_seq from public, anon, authenticated;

comment on table public.dunning_events is 'Tahsilat (dunning) olay gunlugu: fatura x kademe x kanal tek satir; kanal kapaliysa result=channel_disabled.';

notify pgrst, 'reload schema';
