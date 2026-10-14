-- Kanal ROI ve durum sayfası (DG5): pazarlama harcaması, kamuya açık durum sayfası olayları ve sürüm (deploy) geçmişi.
--
-- NE:
--   (1) marketing_spend: kanal × ay pazarlama harcaması (adminden girilir; Google Ads ads_daily_metrics'ten ayrıca otomatik
--       okunur, burada TEKRAR girilmez). Kanal anahtarları src/lib/measure/channel.ts CHANNELS ile aynıdır (kayıt atfıyla
--       aynı sınıflandırma). Ay + kanal başına tek satır (upsert).
--   (2) status_incidents: /durum sayfasındaki olay ve planlı bakım kayıtları (başlık, etki, durum, zaman penceresi).
--       Olay: investigating -> identified -> monitoring -> resolved. Bakım: scheduled -> in_progress -> completed.
--   (3) status_incident_updates: olay zaman çizelgesi (her durum değişikliği ve not; kamuya açık metin).
--   (4) release_history: scripts/sunucu/deploy.sh'ın her yayın sonunda yazdığı sürüm satırı (SHA, imaj etiketi, sonuç:
--       ok | rolled_back | failed, süre, son migration). Hata kayıtları (error_logs.release) bu SHA ile eşleşir.
-- ERİŞİM: tüm yeni tablolar RLS açık + FORCE, politika yok, anon/authenticated REVOKE; yalnız service_role
--       (/durum sayfası sunucuda yalnız yayımlanmış kamu alanlarını okur; personel kimliği dışarı çıkmaz).
-- KOD: tablolar yokken Kanal ROI harcamayı yalnız Google Ads'ten okur ve formu "kurulum bekliyor" der; /durum ölçülen
--      erişilebilirliği gösterir, olay bölümü boş kalır; deploy.sh tablo yoksa satır yazmayı sessizce atlar.
-- GERİ ALMA: rollbacks/20261014005000_channel_roi_status_page.rollback.sql.
-- RİSK: düşük. Yalnız yeni tablolar; mevcut tabloya dokunulmaz.

set local lock_timeout = '5s';

-- (1) pazarlama harcaması
create table if not exists public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  channel text not null,
  amount_try numeric(14, 2) not null,
  note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_spend_month_first check (extract(day from month) = 1),
  constraint marketing_spend_channel check (channel in (
    'paid_search', 'organic_search', 'social', 'referral_site', 'direct', 'email', 'office_invite', 'partner', 'vitrin_signature', 'unknown'
  )),
  constraint marketing_spend_amount check (amount_try >= 0 and amount_try <= 100000000),
  constraint marketing_spend_note_len check (note is null or char_length(note) <= 300),
  constraint marketing_spend_month_channel unique (month, channel)
);
create index if not exists marketing_spend_month_idx on public.marketing_spend (month desc);

-- (2) durum sayfası olayları ve planlı bakımlar
create table if not exists public.status_incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'incident',
  title text not null,
  impact text not null default 'minor',
  status text not null,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint status_incidents_kind check (kind in ('incident', 'maintenance')),
  constraint status_incidents_title_len check (char_length(btrim(title)) between 3 and 140),
  constraint status_incidents_impact check (impact in ('minor', 'major', 'critical')),
  constraint status_incidents_status check (
    (kind = 'incident' and status in ('investigating', 'identified', 'monitoring', 'resolved'))
    or (kind = 'maintenance' and status in ('scheduled', 'in_progress', 'completed'))
  ),
  constraint status_incidents_window check (
    kind = 'incident' or (scheduled_start is not null and scheduled_end is not null and scheduled_end > scheduled_start)
  ),
  constraint status_incidents_resolved check (
    (status in ('resolved', 'completed')) = (resolved_at is not null)
  )
);
create index if not exists status_incidents_open_idx on public.status_incidents (started_at desc) where resolved_at is null;
create index if not exists status_incidents_recent_idx on public.status_incidents (started_at desc);

create table if not exists public.status_incident_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.status_incidents(id) on delete cascade,
  status text not null,
  message text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint status_incident_updates_status check (status in (
    'investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress', 'completed'
  )),
  constraint status_incident_updates_message_len check (char_length(btrim(message)) between 1 and 2000)
);
create index if not exists status_incident_updates_incident_idx on public.status_incident_updates (incident_id, created_at desc);

-- (4) sürüm geçmişi (deploy.sh yazar)
create table if not exists public.release_history (
  id bigint generated always as identity primary key,
  sha text not null,
  tag text not null,
  outcome text not null,
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  duration_sec integer,
  release_migration text,
  subject text,
  actor text,
  host text,
  detail text,
  constraint release_history_sha_len check (char_length(sha) between 1 and 64),
  constraint release_history_tag_len check (char_length(tag) between 1 and 120),
  constraint release_history_outcome check (outcome in ('ok', 'rolled_back', 'failed')),
  constraint release_history_duration check (duration_sec is null or duration_sec >= 0),
  constraint release_history_migration_len check (release_migration is null or char_length(release_migration) <= 200),
  constraint release_history_subject_len check (subject is null or char_length(subject) <= 200),
  constraint release_history_actor_len check (actor is null or char_length(actor) <= 80),
  constraint release_history_host_len check (host is null or char_length(host) <= 80),
  constraint release_history_detail_len check (detail is null or char_length(detail) <= 500)
);
create index if not exists release_history_finished_idx on public.release_history (finished_at desc);

-- Erişim: yalnız service_role
do $$
declare t text;
begin
  foreach t in array array['marketing_spend', 'status_incidents', 'status_incident_updates', 'release_history']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
