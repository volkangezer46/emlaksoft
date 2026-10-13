-- 20261013005000 geri alma: append-only tetik, personel oturum RPC'leri, destek erisimi gecmisi, yedek/tatbikat
-- tablolari kalkar. platform_audit_logs ve platform_impersonation_sessions'a eklenen kolonlar DUSURULMEZ (veri kaybi
-- olmasin; kod kolonlar varken de eski yolla calisir). Gecmis/yedek kayitlari silinir (yeniden olusturulamaz).
drop trigger if exists trg_platform_audit_logs_append_only on public.platform_audit_logs;
drop trigger if exists trg_platform_audit_logs_no_truncate on public.platform_audit_logs;
drop function if exists public.platform_audit_logs_append_only();

drop function if exists public.platform_list_staff_sessions();
drop function if exists public.platform_revoke_staff_session(uuid);

drop table if exists public.platform_impersonation_history;
drop table if exists public.backup_runs;
drop table if exists public.restore_drills;

notify pgrst, 'reload schema';
