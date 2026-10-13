-- AD7 E-posta altyapısı: gönderim günlüğü (email_sends), sağlayıcı olayları (email_events) ve bastırma listesi
-- (email_suppressions) + budama RPC'si (email_log_prune).
--
-- Platform verisidir (EmlakSoft'un ofislere/personele gönderdiği işlemsel e-postalar): RLS açık, politika yok ->
--   yalnız service_role erişir (site_issues deseni). Yönetim ekranı ve Ofis 360 sunucuda service_role ile okur.
-- KİŞİSEL VERİ: alıcı adresi DÜZ SAKLANMAZ; yalnız maskeli gösterim (to_masked, "ay***@ornek.com") ve küçük harfe
--   çevrilmiş adresin SHA-256 özeti (to_hash; bastırma eşleşmesi ve aynı alıcıyı süzme için). Gövde saklanmaz.
-- email_sends.status: sent (sağlayıcı kabul etti) -> delivered/opened/clicked/delayed (webhook) | bounced/complained
--   (webhook; adres bastırma listesine girer) | failed (sağlayıcı hatası) | suppressed (bastırılmış adrese gönderim
--   engellendi) | disabled (kanal kapalı; istek ATILMADI). tenant_id: e-postanın ilgili olduğu ofis (yoksa null).
-- email_events.event_id: Svix mesaj kimliği (svix-id) -> webhook yeniden denemeleri idempotent.
-- email_log_prune(): gönderimler 400 gün, olaylar 180 gün sonra silinir; bastırma kayıtları silinmez (elle kaldırılır).
-- KOD DAVRANIŞI: tablolar yokken gönderim sürer (günlük/bastırma sessizce atlanır), ekran "kurulum bekliyor" der.
-- GERİ ALMA: supabase/rollbacks/20261013004600_email_log.rollback.sql (yalnız bu üç tablo + RPC).
-- RİSK: düşük (yeni tablolar + bir fonksiyon; mevcut nesnelere dokunmaz).

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id) on delete set null,
  template text not null check (char_length(template) between 1 and 64),
  source text not null default 'system' check (char_length(source) between 1 and 64),
  to_hash text not null check (to_hash ~ '^[0-9a-f]{64}$'),
  to_masked text not null check (char_length(to_masked) between 1 and 120),
  subject text not null default '' check (char_length(subject) <= 200),
  status text not null
    check (status in ('sent', 'delivered', 'delayed', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'suppressed', 'disabled')),
  provider_id text unique check (provider_id is null or char_length(provider_id) between 1 and 120),
  error text check (error is null or char_length(error) <= 300),
  actor_id uuid,
  delivered_at timestamptz,
  opened_at timestamptz,
  last_event_at timestamptz
);

create index if not exists email_sends_created_idx on public.email_sends (created_at desc);
create index if not exists email_sends_tenant_idx on public.email_sends (tenant_id, created_at desc) where tenant_id is not null;
create index if not exists email_sends_status_idx on public.email_sends (status, created_at desc);
create index if not exists email_sends_to_hash_idx on public.email_sends (to_hash, created_at desc);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique check (char_length(event_id) between 1 and 120),
  send_id uuid references public.email_sends(id) on delete cascade,
  provider_id text check (provider_id is null or char_length(provider_id) <= 120),
  type text not null check (char_length(type) between 1 and 48),
  detail text check (detail is null or char_length(detail) <= 300),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists email_events_send_idx on public.email_events (send_id, occurred_at desc);
create index if not exists email_events_created_idx on public.email_events (created_at);

create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null unique check (email_hash ~ '^[0-9a-f]{64}$'),
  email_masked text not null check (char_length(email_masked) between 1 and 120),
  reason text not null check (reason in ('bounce', 'complaint', 'manual')),
  detail text check (detail is null or char_length(detail) <= 300),
  source_send_id uuid references public.email_sends(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists email_suppressions_created_idx on public.email_suppressions (created_at desc);

alter table public.email_sends enable row level security;
alter table public.email_events enable row level security;
alter table public.email_suppressions enable row level security;
-- Politika bilerek yok: anon/authenticated hiçbir şey göremez; service_role RLS'i atlar.
revoke all on public.email_sends from anon, authenticated;
revoke all on public.email_events from anon, authenticated;
revoke all on public.email_suppressions from anon, authenticated;
grant all on public.email_sends to service_role;
grant all on public.email_events to service_role;
grant all on public.email_suppressions to service_role;

create or replace function public.email_log_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
  step integer := 0;
begin
  delete from public.email_events where created_at < now() - interval '180 days';
  get diagnostics step = row_count;
  removed := removed + step;
  delete from public.email_sends where created_at < now() - interval '400 days';
  get diagnostics step = row_count;
  removed := removed + step;
  return removed;
end;
$$;

revoke all on function public.email_log_prune() from public, anon, authenticated;
grant execute on function public.email_log_prune() to service_role;

notify pgrst, 'reload schema';
