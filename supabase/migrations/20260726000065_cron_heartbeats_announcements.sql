-- Cron sağlık kalp atışları + platform duyuru geçmişi
--
-- ============================================================================
-- NEDEN
-- ============================================================================
-- 1) cron_heartbeats: 9 cron ucu var ama "en son ne zaman çalıştı?" sorusunun
--    cevabı yalnızca Vercel loglarında. Her cron çalışmasının sonunda tek satır
--    upsert edilir; /admin/sistem bu tabloyu okuyup 24 saatten eski kayıtları
--    "gecikmiş" olarak işaretler.
-- 2) platform_announcements: /admin/duyuru gönderimleri `notifications`
--    tablosuna tenant başına satır olarak dağılıyordu — "dün hangi duyuruyu
--    kaç ofise gönderdik?" sorusu cevaplanamıyordu. Her gönderim burada TEK
--    satır olarak arşivlenir.
--
-- Her iki tabloya da yazma yalnızca service_role üzerinden yapılır (cron ve
-- server action'lar admin client kullanır). Platform personeli okuyabilir —
-- platform_audit_logs / platform_notifications desenindeki gibi RLS +
-- is_platform_staff okuma politikası korunur.

-- ----------------------------------------------------------------------------
-- Cron kalp atışları
-- ----------------------------------------------------------------------------
create table if not exists public.cron_heartbeats (
  -- Job adı route klasörüyle aynı: 'tcmb-kur', 'gunluk-ozet' …
  job          text primary key,
  last_run_at  timestamptz not null default now(),
  last_status  text not null default 'ok',
  last_detail  text
);

alter table public.cron_heartbeats enable row level security;

drop policy if exists cron_heartbeats_staff_read on public.cron_heartbeats;
create policy cron_heartbeats_staff_read on public.cron_heartbeats
  for select
  using (public.is_platform_staff());

grant select on public.cron_heartbeats to authenticated;
grant all on public.cron_heartbeats to service_role;

comment on table public.cron_heartbeats is
  'Cron uclarinin son calisma kaydi (job basina tek satir, upsert).';

-- ----------------------------------------------------------------------------
-- Duyuru geçmişi
-- ----------------------------------------------------------------------------
create table if not exists public.platform_announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  kind        text not null default 'info'
    check (kind in ('info','success','warning','danger','system')),
  -- Hedef kitle: sendBroadcast'teki BroadcastTarget ile birebir.
  audience    text not null default 'all'
    check (audience in ('all','active','trial','specific')),
  -- Yalnızca audience='specific' iken dolu. Ofis silinirse geçmiş kaybolmasın.
  tenant_id   uuid references public.tenants(id) on delete set null,
  -- Gönderim anında kaç ofise ulaştığı (notifications fan-out sayısı).
  sent_count  integer not null default 0,
  created_by  uuid references public.platform_staff(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_platform_announcements_created
  on public.platform_announcements (created_at desc);

alter table public.platform_announcements enable row level security;

drop policy if exists platform_announcements_staff_read on public.platform_announcements;
create policy platform_announcements_staff_read on public.platform_announcements
  for select
  using (public.is_platform_staff());

grant select on public.platform_announcements to authenticated;
grant all on public.platform_announcements to service_role;

comment on table public.platform_announcements is
  'Toplu duyuru arsivi: gonderim basina tek satir (hedef + ulasan ofis sayisi).';
