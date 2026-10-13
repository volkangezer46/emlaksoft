-- SP1 Büyüme Kokpiti: birleşik öneri kuyruğu (site_issues) ve optimize edici işlem kaydı (site_optimizer_actions).
--
-- Tenant verisi DEĞİLDİR (herkese açık sitenin denetim bulguları): RLS açık, politika yok -> yalnız service_role erişir
--   (seo_404_hits deseni). Kişisel veri SAKLANMAZ: url yalnız yol (sorgu dizesi yok), kanıt/öneri yalnız sayfa meta verisi.
-- fingerprint = area|code|url_norm (url_norm: sorgu, parça ve sondaki "/" atılmış yol; uygulama katmanı üretir).
-- collector: bulguyu üreten toplayıcı; kaybolan bulgu yalnız AYNI toplayıcının taradığı URL için "dogrulandi" olur.
-- site_issues_prune(): dogrulandi/yoksayildi 180 gün, site_optimizer_actions 2 yıl sonra silinir (yalnız service_role).
-- KOD DAVRANIŞI: tablo yoksa Kokpit "kurulum bekliyor" boş durumunu gösterir; yayın sonrası kayıt sessizce atlanır.
-- GERİ ALMA: supabase/rollbacks/20261013003000_site_issues.rollback.sql (yalnız bu iki tablo + RPC).
-- RİSK: düşük (yeni tablolar + bir fonksiyon; mevcut nesnelere dokunmaz).

create table if not exists public.site_issues (
  id uuid primary key default gen_random_uuid(),
  area text not null check (area in ('seo', 'hiz', 'olcum', 'reklam', 'icerik')),
  url text not null check (char_length(url) between 1 and 300 and position('?' in url) = 0),
  code text not null check (char_length(code) between 1 and 64),
  severity text not null check (severity in ('kritik', 'uyari', 'bilgi')),
  title text not null check (char_length(title) between 1 and 160),
  explain text not null default '' check (char_length(explain) <= 240),
  fingerprint text not null unique check (char_length(fingerprint) <= 400),
  collector text not null default 'builtin' check (char_length(collector) between 1 and 64),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  status text not null default 'acik'
    check (status in ('acik', 'onerildi', 'taslakta', 'yayinda', 'dogrulandi', 'yeniden_acildi', 'yoksayildi')),
  evidence jsonb,
  proposal jsonb,
  href text check (href is null or char_length(href) <= 300),
  manual_only boolean not null default false,
  publish_ref text check (publish_ref is null or char_length(publish_ref) <= 120),
  resolved_at timestamptz,
  ignored_by uuid,
  ignored_reason text check (ignored_reason is null or char_length(ignored_reason) <= 240)
);

create index if not exists site_issues_status_idx on public.site_issues (status, area);
create index if not exists site_issues_collector_idx on public.site_issues (collector);
create index if not exists site_issues_resolved_idx on public.site_issues (resolved_at) where resolved_at is not null;

create table if not exists public.site_optimizer_actions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) between 1 and 64),
  source text not null check (source in ('staff', 'cron', 'otopilot')),
  target text not null default '' check (char_length(target) <= 300),
  dry_run boolean not null default false,
  status text not null check (char_length(status) between 1 and 32),
  before jsonb,
  after jsonb,
  publish_ref text check (publish_ref is null or char_length(publish_ref) <= 120),
  actor uuid,
  created_at timestamptz not null default now()
);

create index if not exists site_optimizer_actions_kind_idx on public.site_optimizer_actions (kind, created_at desc);
create index if not exists site_optimizer_actions_source_idx on public.site_optimizer_actions (source, created_at desc);
create index if not exists site_optimizer_actions_created_idx on public.site_optimizer_actions (created_at);

alter table public.site_issues enable row level security;
alter table public.site_optimizer_actions enable row level security;
-- Politika bilerek yok: anon/authenticated hiçbir şey göremez; service_role RLS'i atlar.
revoke all on public.site_issues from anon, authenticated;
revoke all on public.site_optimizer_actions from anon, authenticated;
grant all on public.site_issues to service_role;
grant all on public.site_optimizer_actions to service_role;

create or replace function public.site_issues_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
  step integer := 0;
begin
  delete from public.site_issues
   where status in ('dogrulandi', 'yoksayildi')
     and coalesce(resolved_at, last_seen) < now() - interval '180 days';
  get diagnostics step = row_count;
  removed := removed + step;

  delete from public.site_optimizer_actions where created_at < now() - interval '2 years';
  get diagnostics step = row_count;
  return removed + step;
end;
$$;

revoke all on function public.site_issues_prune() from public, anon, authenticated;
grant execute on function public.site_issues_prune() to service_role;

comment on table public.site_issues is 'Büyüme Kokpiti: herkese açık sitenin birleşik bulgu kuyruğu (kişisel veri yok).';
comment on table public.site_optimizer_actions is 'Büyüme Kokpiti: denetim, hazırlık, otopilot ve yayın sonrası doğrulama işlem kaydı.';

notify pgrst, 'reload schema';
