-- Rollback: access_audit_log tablosunu sil
drop policy if exists access_audit_log_read on public.access_audit_log;
drop table if exists public.access_audit_log;
