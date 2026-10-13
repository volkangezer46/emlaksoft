-- AD11 Guvenlik, yedek ve uyum sertlestirmesi.
--
-- 1) platform_audit_logs: ip, user_agent, before, after kolonlari + APPEND-ONLY tetik (UPDATE/DELETE/TRUNCATE yasak).
--    Tek istisna: personel satiri silinince FK (ON DELETE SET NULL) actor_id'yi bosaltir; bu yalniz RI tetigi icinden
--    (pg_trigger_depth() > 1) ve yalniz actor_id degisirse gecer. service_role zaten yalniz INSERT/SELECT yetkilidir.
-- 2) platform_impersonation_sessions: reason, ticket_id, ended_at (anlik goruntu satiri; durdurunca silinir) +
--    kalici gecmis platform_impersonation_history (gerekce + bilet no zorunlu, ended_at, bitis bicimi).
-- 3) backup_runs + restore_drills: sunucu betikleri (scripts/sunucu/backup-db.sh, restore-drill.sh) psql ile yazar
--    (supabase_admin); panel service_role ile okur. Tenant verisi DEGILDIR.
-- 4) platform_list_staff_sessions / platform_revoke_staff_session: personel aktif oturum listesi ve tekil kapatma
--    (yalniz service_role; cagiran yetkiyi sunucuda dogrular).
-- Ayar anahtarlari (platform_settings; tablo degisikligi YOK, kod yazar): platform.admin_ip_allowlist,
--   platform.session_idle_minutes, platform.session_max_hours, platform.step_up_required, ops.backup.*,
--   ops.restore_drill.* (tanimlar src/lib/settings/registry/security.ts).
-- KOD DAVRANISI: kolon/tablo/RPC yokken kod eski yola duser (denetim satiri eski kolonlarla yazilir, gecmis listesi
--   "kurulum bekliyor", oturum listesi bos).
-- GERI ALMA: supabase/rollbacks/20261013005000_ad11_security_hardening.rollback.sql
-- RISK: dusuk-orta (append-only tetik yeni bir yasak getirir; mevcut kod platform_audit_logs'u guncellemez/silmez).

-- 1) Denetim izi ------------------------------------------------------------------------------------------------
alter table public.platform_audit_logs
  add column if not exists ip text,
  add column if not exists user_agent text,
  add column if not exists before jsonb,
  add column if not exists after jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_audit_logs_ip_len') then
    alter table public.platform_audit_logs
      add constraint platform_audit_logs_ip_len check (ip is null or char_length(ip) <= 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'platform_audit_logs_user_agent_len') then
    alter table public.platform_audit_logs
      add constraint platform_audit_logs_user_agent_len check (user_agent is null or char_length(user_agent) <= 400);
  end if;
end $$;

create or replace function public.platform_audit_logs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Personel silinince FK eylemi (RI tetigi icinden) actor_id'yi bosaltir; baska hicbir alan degisemez.
    if pg_trigger_depth() > 1
       and old.actor_id is not null
       and new.actor_id is null
       and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
      return new;
    end if;
    raise exception 'platform_audit_logs yalniz eklenir: UPDATE yasak.' using errcode = '42501';
  end if;
  raise exception 'platform_audit_logs yalniz eklenir: % yasak.', tg_op using errcode = '42501';
end;
$$;

revoke all privileges on function public.platform_audit_logs_append_only() from public, anon, authenticated, service_role;

drop trigger if exists trg_platform_audit_logs_append_only on public.platform_audit_logs;
create trigger trg_platform_audit_logs_append_only
  before update or delete on public.platform_audit_logs
  for each row execute function public.platform_audit_logs_append_only();

drop trigger if exists trg_platform_audit_logs_no_truncate on public.platform_audit_logs;
create trigger trg_platform_audit_logs_no_truncate
  before truncate on public.platform_audit_logs
  for each statement execute function public.platform_audit_logs_append_only();

comment on table public.platform_audit_logs is
  'Platform personeli denetim izi. YALNIZ EKLENIR (trg_platform_audit_logs_append_only): UPDATE/DELETE/TRUNCATE yasak.';

-- 2) Destek erisimi (impersonation) ------------------------------------------------------------------------------
alter table public.platform_impersonation_sessions
  add column if not exists reason text,
  add column if not exists ticket_id text,
  add column if not exists ended_at timestamptz;

create table if not exists public.platform_impersonation_history (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.platform_staff(id) on delete set null,
  target_tenant_id uuid references public.tenants(id) on delete set null,
  auth_session_id text not null check (char_length(btrim(auth_session_id)) between 1 and 256),
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  ticket_id text not null check (char_length(btrim(ticket_id)) between 1 and 64),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_kind text check (end_kind is null or end_kind in ('stopped', 'expired', 'recovered')),
  constraint platform_impersonation_history_end_order check (ended_at is null or ended_at >= started_at)
);

create index if not exists platform_impersonation_history_started_idx
  on public.platform_impersonation_history (started_at desc);
create index if not exists platform_impersonation_history_session_idx
  on public.platform_impersonation_history (staff_id, auth_session_id);
create index if not exists platform_impersonation_history_tenant_idx
  on public.platform_impersonation_history (target_tenant_id, started_at desc);

alter table public.platform_impersonation_history enable row level security;
-- Politika bilerek yok: yalniz service_role (sunucu, personel kapisindan sonra) okur/yazar.
revoke all on table public.platform_impersonation_history from public, anon, authenticated;
grant select, insert, update on table public.platform_impersonation_history to service_role;

comment on table public.platform_impersonation_history is
  'Destek erisimi (ofise gir) gecmisi: gerekce + bilet no zorunlu; ended_at durdurulunca yazilir (bos + suresi gecmis = suresi doldu).';

-- 3) Yedek ve geri yukleme tatbikati ------------------------------------------------------------------------------
create table if not exists public.backup_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'error', 'partial')),
  db_file text check (db_file is null or char_length(db_file) <= 200),
  storage_file text check (storage_file is null or char_length(storage_file) <= 200),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  storage_bytes bigint check (storage_bytes is null or storage_bytes >= 0),
  tables integer check (tables is null or tables >= 0),
  encrypted boolean not null default false,
  remote boolean not null default false,
  remote_kind text check (remote_kind is null or remote_kind in ('off', 'ssh', 'rclone')),
  storage_objects integer,
  archive_files integer,
  detail text check (detail is null or char_length(detail) <= 500)
);
create index if not exists backup_runs_finished_idx on public.backup_runs (finished_at desc);

create table if not exists public.restore_drills (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'error')),
  backup_file text check (backup_file is null or char_length(backup_file) <= 200),
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  tables_checked integer check (tables_checked is null or tables_checked >= 0),
  restore_errors integer check (restore_errors is null or restore_errors >= 0),
  mismatches jsonb not null default '[]'::jsonb,
  detail text check (detail is null or char_length(detail) <= 500)
);
create index if not exists restore_drills_finished_idx on public.restore_drills (finished_at desc);

alter table public.backup_runs enable row level security;
alter table public.restore_drills enable row level security;
revoke all on table public.backup_runs from public, anon, authenticated;
revoke all on table public.restore_drills from public, anon, authenticated;
grant select on table public.backup_runs to service_role;
grant select on table public.restore_drills to service_role;
revoke all on sequence public.backup_runs_id_seq from public, anon, authenticated;
revoke all on sequence public.restore_drills_id_seq from public, anon, authenticated;

comment on table public.backup_runs is 'Gece yedegi kosulari (scripts/sunucu/backup-db.sh yazar; panel yalniz okur).';
comment on table public.restore_drills is 'Haftalik geri yukleme tatbikati (gecici konteynere restore + satir sayisi; scripts/sunucu/restore-drill.sh).';

-- 4) Personel oturumlari -----------------------------------------------------------------------------------------
create or replace function public.platform_list_staff_sessions()
returns table (
  session_id uuid,
  user_id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  updated_at timestamptz,
  user_agent text,
  ip text,
  aal text,
  not_after timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  return query
    select s.id, s.user_id, s.created_at, (s.refreshed_at at time zone 'UTC'), s.updated_at,
           left(s.user_agent, 300), host(s.ip), s.aal::text, s.not_after
    from auth.sessions s
    join public.platform_staff ps on ps.id = s.user_id
    where ps.is_active = true
      and (s.not_after is null or s.not_after > now())
    order by coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) desc nulls last
    limit 200;
end;
$$;

create or replace function public.platform_revoke_staff_session(p_session_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_session_id is null then
    return false;
  end if;
  delete from auth.sessions s
  using public.platform_staff ps
  where s.id = p_session_id and ps.id = s.user_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all privileges on function public.platform_list_staff_sessions() from public, anon, authenticated, service_role;
revoke all privileges on function public.platform_revoke_staff_session(uuid) from public, anon, authenticated, service_role;
grant execute on function public.platform_list_staff_sessions() to service_role;
grant execute on function public.platform_revoke_staff_session(uuid) to service_role;

comment on function public.platform_list_staff_sessions() is
  'Service-role-only: aktif platform personelinin acik oturumlari (en cok 200).';
comment on function public.platform_revoke_staff_session(uuid) is
  'Service-role-only: tek personel oturumunu kapatir (yenileme anahtari gecersiz; erisim JWT''si suresi dolana kadar gecer).';

notify pgrst, 'reload schema';
