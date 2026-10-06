-- Rollback: scope_overrides tablosunu sil
drop policy if exists scope_overrides_write on public.scope_overrides;
drop policy if exists scope_overrides_read on public.scope_overrides;
drop table if exists public.scope_overrides;
