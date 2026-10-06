-- Rollback 20261006000104_access_control_write_policies.sql: INSERT politikasi ve grant geri alinir (000102 durumu).
drop policy if exists access_audit_log_insert on public.access_audit_log;
revoke insert on public.access_audit_log from authenticated;
