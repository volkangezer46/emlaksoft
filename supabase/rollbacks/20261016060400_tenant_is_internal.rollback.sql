-- ROLLBACK 20261016060400_tenant_is_internal.sql
-- Koruma tetikleyicisi, fonksiyonu, kismi indeks ve tenants.is_internal sutunu kalkar.
-- ONCE 20261016060500 geri alinmalidir (platform_reporting_aggregates govdesi is_internal'i okur).
-- Idempotent: if exists.
set local lock_timeout = '5s';

drop trigger if exists trg_guard_tenant_is_internal on public.tenants;
drop function if exists public.guard_tenant_is_internal();
drop index if exists public.tenants_is_internal_idx;
alter table public.tenants drop column if exists is_internal;
