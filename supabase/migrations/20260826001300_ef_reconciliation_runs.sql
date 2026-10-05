-- MIGRATION 20260826001300_ef_reconciliation_runs.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826001300_ef_reconciliation_runs.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826001300_ef_reconciliation_runs.rollback.sql
-- BAGIMLILIK: public.is_platform_staff() (platform personeli okuma politikasi). ef_credit_reservations 20260826000100'de.
--
-- AMAC (WP7): gunluk EmlakFiyati kontor mutabakati sonuclarini saklar (cron: ef-kontor-mutabakat).
--   Yalniz EKLER: yeni tablo. Yazma yalniz service_role (RLS acik, yazma politikasi YOK); okuma yalniz platform personeli.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.is_platform_staff()') is null then
    raise exception 'is_platform_staff() yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regclass('public.ef_credit_reservations') is null then
    raise exception 'ef_credit_reservations yok; once 20260826000100_ef_credit_wallet uygulanmali.';
  end if;
end $$;

create table if not exists public.ef_reconciliation_runs (
  id                uuid primary key default gen_random_uuid(),
  run_at            timestamptz not null default now(),
  window_start      timestamptz not null,
  window_end        timestamptz not null,
  ef_degerleme      integer,
  ef_pdf            integer,
  ledger_degerleme  integer not null default 0,
  ledger_pdf        integer not null default 0,
  diff_degerleme    integer,
  diff_pdf          integer,
  status            text not null,
  meta              jsonb not null default '{}'::jsonb,
  constraint ef_reconciliation_runs_status_check check (status in ('ok', 'drift', 'error')),
  constraint ef_reconciliation_runs_window_check check (window_end >= window_start)
);

create index if not exists ef_reconciliation_runs_run_at_idx
  on public.ef_reconciliation_runs (run_at desc);

alter table public.ef_reconciliation_runs enable row level security;

drop policy if exists ef_reconciliation_runs_staff_select on public.ef_reconciliation_runs;
create policy ef_reconciliation_runs_staff_select on public.ef_reconciliation_runs
  for select to authenticated
  using ((select public.is_platform_staff()));

revoke all on public.ef_reconciliation_runs from anon, authenticated;
grant select on public.ef_reconciliation_runs to authenticated;
grant all on public.ef_reconciliation_runs to service_role;
