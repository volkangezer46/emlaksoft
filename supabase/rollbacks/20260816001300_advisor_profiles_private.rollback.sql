-- Rollback: 20260816001300_advisor_profiles_private
-- UYARI: danışmanların kişisel/kimlik verisi ve iş profili KALICI silinir. Önce ilgili ekranları kapatın,
-- gerekirse veriyi dışa alın. audit_logs'taki 'advisor_private.change' kayıtları (yalnız alan adı) kalır.
drop trigger if exists trg_advisor_private_audit on public.advisor_private;
drop function if exists public.audit_advisor_private_change();
drop table if exists public.advisor_private;
drop table if exists public.advisor_profiles;
