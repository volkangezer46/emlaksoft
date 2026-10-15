-- MIGRATION 20261019060000_platform_cs_playbooks_nudges.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir:
--   - platform_tasks.source_rule / dedupe_key / priority yokken oyun kitabi adimi (gorev-hatirlat) 'kurulum bekliyor'
--     der ve gorev acmaz; elle gorev olusturma ve /admin/gorevler sutunlar olmadan da calisir.
--   - tenant_lifecycle_nudges yokken aktivasyon durtmesi adimi (abonelik-kontrol) 'kurulum bekliyor' der ve HICBIR
--     bildirim/e-posta gondermez (tekrar korumasi olmadan gonderim yapilmaz).
-- Geri alma: supabase/rollbacks/20261019060000_platform_cs_playbooks_nudges.rollback.sql
-- BAGIMLILIK: 20261013004400 (platform_tasks).
--
-- NE (PA-1 musteri basarisi oyun kitaplari + PA-12 aktivasyon durtmeleri):
--   platform_tasks: kural kaynakli gorevin kaynagi (source_rule), tekrar anahtari (dedupe_key; ayni tetik ayni gorevi
--     ikinci kez acmaz, UNIQUE indeks; NULL serbest) ve onceligi (normal/yuksek). Elle acilan gorevde hepsi bos/normal kalir.
--   tenant_lifecycle_nudges: ofis basina durtme defteri (gun 1/3/7, deneme degeri ozeti, geri kazanim); ofis x anahtar
--     TEK satir (ayni durtme ikinci kez gitmez), uygulama ici ve e-posta sonucu sayilari. Yalniz service_role.
set local lock_timeout = '5s';

alter table public.platform_tasks
  add column if not exists source_rule text,
  add column if not exists dedupe_key text,
  add column if not exists priority text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'platform_tasks_source_rule_check') then
    alter table public.platform_tasks
      add constraint platform_tasks_source_rule_check check (source_rule is null or char_length(source_rule) between 2 and 40);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'platform_tasks_dedupe_key_check') then
    alter table public.platform_tasks
      add constraint platform_tasks_dedupe_key_check check (dedupe_key is null or char_length(dedupe_key) between 3 and 200);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'platform_tasks_priority_check') then
    alter table public.platform_tasks
      add constraint platform_tasks_priority_check check (priority in ('normal', 'yuksek'));
  end if;
end $$;

-- Kismi DEGIL: PostgREST upsert (on_conflict=dedupe_key) yalniz tam indeksi hakem secer; NULL degerler zaten cakismaz.
create unique index if not exists platform_tasks_dedupe_uidx on public.platform_tasks (dedupe_key);
-- Is kuyrugu (/admin/gorevler): acik gorevler vade sirasiyla, kaynak kural suzgeci.
create index if not exists platform_tasks_open_due_idx on public.platform_tasks (status, due_at);
create index if not exists platform_tasks_rule_idx on public.platform_tasks (source_rule, created_at desc) where source_rule is not null;

comment on column public.platform_tasks.source_rule is 'PA-1: gorevi acan oyun kitabi kurali (health_drop, health_threshold, nps_detractor, low_csat, cancel_request, trial_inactive); elle gorevde bos.';
comment on column public.platform_tasks.dedupe_key is 'PA-1: ayni tetik ayni gorevi ikinci kez acmaz (UNIQUE; elle gorevde NULL).';

create table if not exists public.tenant_lifecycle_nudges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nudge_key text not null check (nudge_key in ('d1', 'd3', 'd7', 'trial_recap', 'win_back')),
  kind text not null check (char_length(kind) between 2 and 40),
  step_id text check (step_id is null or char_length(step_id) <= 40),
  in_app_count smallint not null default 0 check (in_app_count >= 0),
  email_sent smallint not null default 0 check (email_sent >= 0),
  email_skipped smallint not null default 0 check (email_skipped >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, nudge_key)
);
create index if not exists tenant_lifecycle_nudges_recent_idx on public.tenant_lifecycle_nudges (created_at desc);

alter table public.tenant_lifecycle_nudges enable row level security;
alter table public.tenant_lifecycle_nudges force row level security;
-- Politika bilerek yok: yalniz service_role (cron ve platform kapisindan sonra admin ekranlari) okur/yazar.
revoke all privileges on table public.tenant_lifecycle_nudges from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_lifecycle_nudges to service_role;

comment on table public.tenant_lifecycle_nudges is
  'PA-12: aktivasyon durtme defteri (gun 1/3/7, deneme degeri ozeti, geri kazanim); ofis x anahtar tek satir; yalniz service_role.';
