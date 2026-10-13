-- Operasyon ve uyarı merkezi (AD10): uyarı kanalları/kuralları/olayları, cron çalışma geçmişi ve duraklatma,
-- sunucu kaynak ölçümleri, hata triyajı (durum, atanan, not, sürüm) ve salt-okunur veritabanı konsolu RPC'leri.
--
-- NE:
--   (1) cron_runs: her cron çalışmasının süresi, sonucu ve ayrıntısı (recordHeartbeat yazar; 30 gün saklanır).
--   (2) cron_job_state: iş bazında duraklatma (paused). Duraklatılan iş zamanlanmış çağrıda erken döner;
--       "Şimdi çalıştır" (elle tetikleme) yine çalışır.
--   (3) alert_channels: Telegram / e-posta / genel webhook kanalları. Hedef ve sırlar config_sealed içinde
--       AES-256-GCM ile şifreli (platform sırları anahtarı; AAD = platform_settings:alert_channel:<id>).
--   (4) alert_rules: kural başına açık/kapalı, eşik, tekrar aralığı ve sessize alma (muted_until).
--   (5) alert_events: tetiklenen/düzelen uyarılar (açık olay parmak izi başına tek satır) + teslim günlüğü.
--   (6) host_metrics: sunucu betiği (scripts/sunucu/host-metrics.sh) disk/RAM/yük/konteyner yazar.
--   (7) error_rate_minutely: hata patlaması kuralı için dakikalık olay sayacı (record_error_occurrence artırır;
--       yok sayılan/ertelenen hatalar sayılmaz).
--   (8) error_logs: status (open|ignored|snoozed|resolved), assignee_id, note, release, snoozed_until.
--       resolved_at ile status bir tetikleyiciyle eşit tutulur (eski "Çözüldü" akışı aynen çalışır).
--   (9) record_error_occurrence: p_release (varsayılan null) eklenir; eski 9 argümanlı çağrı aynen çalışır.
--  (10) ops_db_overview / ops_slow_queries: salt-okunur DB konsolu (boyut, en büyük tablolar, bağlantılar,
--       pg_stat_statements). Yalnız service_role.
-- ERİŞİM: tüm yeni tablolar RLS açık + FORCE, politika yok, anon/authenticated REVOKE; yalnız service_role.
-- KOD: tablolar yokken panel "kurulum bekliyor" der, cron'lar duraklatma kontrolünü atlar (çalışır), uyarı motoru
--      adımı sessizce atlar; hata kaydı eski 9 argümanlı çağrıya düşer.
-- GERİ ALMA: rollbacks/20261013004900_ops_alerts.rollback.sql.
-- RİSK: düşük. error_logs'a varsayılanlı sütun eklenir (PG11+ anlık), record_error_occurrence aynı işlemde
--       yeniden kurulur (kesinti penceresi yok).

set local lock_timeout = '5s';

-- (1) cron çalışma geçmişi
create table if not exists public.cron_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  duration_ms integer,
  status text not null,
  trigger text not null default 'schedule',
  detail text,
  constraint cron_runs_job_len check (char_length(job) between 1 and 80),
  constraint cron_runs_status check (status in ('ok', 'error')),
  constraint cron_runs_trigger check (trigger in ('schedule', 'manual')),
  constraint cron_runs_duration check (duration_ms is null or duration_ms >= 0),
  constraint cron_runs_detail_len check (detail is null or char_length(detail) <= 500)
);
create index if not exists cron_runs_job_started_idx on public.cron_runs (job, started_at desc);
create index if not exists cron_runs_started_idx on public.cron_runs (started_at);

-- (2) iş bazında duraklatma
create table if not exists public.cron_job_state (
  job text primary key,
  paused boolean not null default false,
  paused_at timestamptz,
  paused_by uuid,
  reason text,
  updated_at timestamptz not null default now(),
  constraint cron_job_state_job_len check (char_length(job) between 1 and 80),
  constraint cron_job_state_reason_len check (reason is null or char_length(reason) <= 300)
);

-- (3) uyarı kanalları
create table if not exists public.alert_channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  name text not null,
  enabled boolean not null default true,
  config_sealed text not null,
  target_hint text,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_detail text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alert_channels_kind check (kind in ('telegram', 'email', 'webhook')),
  constraint alert_channels_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint alert_channels_sealed check (config_sealed like 'v1.%' and char_length(config_sealed) <= 4000),
  constraint alert_channels_hint_len check (target_hint is null or char_length(target_hint) <= 120),
  constraint alert_channels_test_len check (last_test_detail is null or char_length(last_test_detail) <= 300)
);

-- (4) uyarı kuralları (anahtar listesi src/lib/alerts/rules.ts ile aynı)
create table if not exists public.alert_rules (
  key text primary key,
  enabled boolean not null default true,
  threshold numeric,
  repeat_minutes integer not null default 60,
  muted_until timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint alert_rules_key check (key in (
    'health_down', 'cron_late', 'cron_error', 'error_burst', 'backup_failed', 'disk_usage', 'payment_capture', 'mrr_drop'
  )),
  constraint alert_rules_repeat check (repeat_minutes between 5 and 10080),
  constraint alert_rules_threshold check (threshold is null or threshold >= 0)
);

insert into public.alert_rules (key, enabled, threshold, repeat_minutes) values
  ('health_down', true, 2, 30),
  ('cron_late', true, null, 180),
  ('cron_error', true, null, 180),
  ('error_burst', true, 20, 60),
  ('backup_failed', true, 26, 360),
  ('disk_usage', true, 85, 180),
  ('payment_capture', true, 1, 120),
  ('mrr_drop', true, 10, 1440)
on conflict (key) do nothing;

-- (5) uyarı olayları
create table if not exists public.alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  fingerprint text not null,
  severity text not null default 'warning',
  source text not null default 'app',
  title text not null,
  body text,
  href text,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  last_notified_at timestamptz,
  notify_count integer not null default 0,
  resolved_at timestamptz,
  resolved_notified_at timestamptz,
  deliveries jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  constraint alert_events_severity check (severity in ('info', 'warning', 'critical')),
  constraint alert_events_source check (source in ('app', 'host')),
  constraint alert_events_fp_len check (char_length(fingerprint) between 1 and 200),
  constraint alert_events_title_len check (char_length(title) between 1 and 200),
  constraint alert_events_body_len check (body is null or char_length(body) <= 2000),
  constraint alert_events_href_len check (href is null or char_length(href) <= 300),
  constraint alert_events_deliveries_array check (jsonb_typeof(deliveries) = 'array'),
  constraint alert_events_meta_object check (jsonb_typeof(meta) = 'object')
);
-- Parmak izi başına tek AÇIK olay: aynı sorun tekrar değerlendirildiğinde yeni satır açılmaz.
create unique index if not exists alert_events_open_uq on public.alert_events (fingerprint) where resolved_at is null;
create index if not exists alert_events_first_idx on public.alert_events (first_at desc);

-- (6) sunucu kaynak ölçümleri
create table if not exists public.host_metrics (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  host text not null,
  disk_total_bytes bigint,
  disk_used_bytes bigint,
  disk_used_pct numeric(5,2),
  mem_total_bytes bigint,
  mem_used_bytes bigint,
  mem_used_pct numeric(5,2),
  load1 numeric(7,2),
  load5 numeric(7,2),
  load15 numeric(7,2),
  cpu_count integer,
  containers jsonb not null default '[]'::jsonb,
  constraint host_metrics_host_len check (char_length(host) between 1 and 80),
  constraint host_metrics_containers_array check (jsonb_typeof(containers) = 'array'),
  constraint host_metrics_disk_pct check (disk_used_pct is null or disk_used_pct between 0 and 100),
  constraint host_metrics_mem_pct check (mem_used_pct is null or mem_used_pct between 0 and 100)
);
create index if not exists host_metrics_at_idx on public.host_metrics (at desc);

-- (7) dakikalık hata sayacı
create table if not exists public.error_rate_minutely (
  minute timestamptz primary key,
  n integer not null default 0
);

-- Erişim: yalnız service_role
do $$
declare t text;
begin
  foreach t in array array['cron_runs', 'cron_job_state', 'alert_channels', 'alert_rules', 'alert_events', 'host_metrics', 'error_rate_minutely']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- (8) hata triyajı sütunları
alter table public.error_logs
  add column if not exists status text not null default 'open',
  add column if not exists assignee_id uuid references public.platform_staff(id) on delete set null,
  add column if not exists note text,
  add column if not exists release text,
  add column if not exists snoozed_until timestamptz;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'error_logs_status_check' and conrelid = 'public.error_logs'::regclass) then
    alter table public.error_logs add constraint error_logs_status_check check (status in ('open', 'ignored', 'snoozed', 'resolved'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'error_logs_note_len' and conrelid = 'public.error_logs'::regclass) then
    alter table public.error_logs add constraint error_logs_note_len check (note is null or char_length(note) <= 2000);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'error_logs_release_len' and conrelid = 'public.error_logs'::regclass) then
    alter table public.error_logs add constraint error_logs_release_len check (release is null or char_length(release) <= 64);
  end if;
end $$;

update public.error_logs set status = 'resolved' where resolved_at is not null and status <> 'resolved';

create index if not exists error_logs_status_idx on public.error_logs (status, last_seen desc);

-- status <-> resolved_at eşitliği: açık durum değişikliği önce gelir, yoksa resolved_at değişimi durumu belirler.
create or replace function public.error_logs_sync_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'resolved' then
      new.resolved_at := coalesce(new.resolved_at, now());
    else
      new.resolved_at := null;
    end if;
  elsif new.resolved_at is distinct from old.resolved_at then
    new.status := case when new.resolved_at is null then 'open' else 'resolved' end;
  end if;
  if new.status <> 'snoozed' then
    new.snoozed_until := null;
  end if;
  return new;
end;
$$;

drop trigger if exists error_logs_sync_status on public.error_logs;
create trigger error_logs_sync_status
  before update on public.error_logs
  for each row execute function public.error_logs_sync_status();

-- (9) record_error_occurrence: sürüm (release) + dakikalık sayaç. Eski imza düşürülür, yenisi p_release
-- varsayılanıyla kurulur (aynı işlem: arada fonksiyonsuz an yok; 9 adlı argümanlı eski çağrı eşleşir).
drop function if exists public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text);

create or replace function public.record_error_occurrence(
  p_tenant_id uuid,
  p_user_id uuid,
  p_source text,
  p_digest text,
  p_message text,
  p_stack text,
  p_path text,
  p_user_agent text,
  p_fingerprint text,
  p_release text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_release text := nullif(left(btrim(coalesce(p_release, '')), 64), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.error_logs (
    tenant_id, user_id, source, digest, message, stack, path, user_agent, fingerprint, release
  ) values (
    p_tenant_id, p_user_id, p_source, p_digest, p_message, p_stack, p_path, p_user_agent, p_fingerprint, v_release
  )
  on conflict (
    (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    fingerprint
  ) where resolved_at is null
  do update set
    occurrences = public.error_logs.occurrences + 1,
    last_seen = now(),
    release = coalesce(excluded.release, public.error_logs.release)
  returning id, status into v_id, v_status;

  -- Yok sayılan / ertelenen hata patlama sayacına girmez (triyaj kararı uyarıyı susturur).
  if v_status = 'open' then
    insert into public.error_rate_minutely (minute, n)
    values (date_trunc('minute', now()), 1)
    on conflict (minute) do update set n = public.error_rate_minutely.n + 1;
  end if;

  return v_id;
end;
$$;

revoke all on function public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_error_occurrence(uuid, uuid, text, text, text, text, text, text, text, text)
  to service_role;

-- (10) salt-okunur DB konsolu
create or replace function public.ops_db_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'db_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'max_connections', pg_catalog.current_setting('max_connections')::int,
    'connections', (select count(*) from pg_catalog.pg_stat_activity a where a.datname = pg_catalog.current_database()),
    'connections_active', (select count(*) from pg_catalog.pg_stat_activity a where a.datname = pg_catalog.current_database() and a.state = 'active'),
    'connections_idle_tx', (select count(*) from pg_catalog.pg_stat_activity a where a.datname = pg_catalog.current_database() and a.state like 'idle in transaction%'),
    'connections_total', (select count(*) from pg_catalog.pg_stat_activity a where a.backend_type = 'client backend'),
    'stat_statements', pg_catalog.to_regclass('extensions.pg_stat_statements') is not null,
    'tables', coalesce((
      select jsonb_agg(t order by t.total_bytes desc)
      from (
        select n.nspname as schema,
               c.relname as name,
               pg_catalog.pg_total_relation_size(c.oid) as total_bytes,
               pg_catalog.pg_relation_size(c.oid) as table_bytes,
               greatest(c.reltuples, 0)::bigint as rows_estimate
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'm')
          and n.nspname not in ('pg_catalog', 'information_schema')
          and n.nspname not like 'pg_toast%'
        order by pg_catalog.pg_total_relation_size(c.oid) desc
        limit 10
      ) t
    ), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.ops_slow_queries(p_limit integer default 10)
returns table (query text, calls bigint, mean_ms double precision, total_ms double precision, rows_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if pg_catalog.to_regclass('extensions.pg_stat_statements') is null then
    return;
  end if;
  -- Sorgu metni pg_stat_statements tarafından normalleştirilmiştir (sabitler $n); yine de 400 karakterde kırpılır.
  return query execute
    'select left(s.query, 400), s.calls, s.mean_exec_time, s.total_exec_time, s.rows
       from extensions.pg_stat_statements s
      where s.dbid = (select d.oid from pg_catalog.pg_database d where d.datname = pg_catalog.current_database())
        and s.calls >= 3
      order by s.mean_exec_time desc
      limit $1'
    using least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

revoke all on function public.ops_db_overview() from public, anon, authenticated;
revoke all on function public.ops_slow_queries(integer) from public, anon, authenticated;
grant execute on function public.ops_db_overview() to service_role;
grant execute on function public.ops_slow_queries(integer) to service_role;

comment on table public.cron_runs is 'Cron çalışma geçmişi (süre, sonuç, ayrıntı); recordHeartbeat yazar, 30 gün saklanır. Yalnız service_role.';
comment on table public.cron_job_state is 'Cron iş bazında duraklatma; duraklatılan iş zamanlanmış çağrıda erken döner. Yalnız service_role.';
comment on table public.alert_channels is 'Uyarı kanalları (Telegram/e-posta/webhook); hedef ve sırlar config_sealed içinde şifreli. Yalnız service_role.';
comment on table public.alert_rules is 'Uyarı kuralları: açık/kapalı, eşik, tekrar aralığı, sessize alma. Yalnız service_role.';
comment on table public.alert_events is 'Uyarı olayları (açık parmak izi başına tek satır) + teslim günlüğü. Yalnız service_role.';
comment on table public.host_metrics is 'Sunucu kaynak ölçümleri (scripts/sunucu/host-metrics.sh). Yalnız service_role.';
comment on table public.error_rate_minutely is 'Dakikalık hata olayı sayacı (hata patlaması kuralı). Yalnız service_role.';

notify pgrst, 'reload schema';
