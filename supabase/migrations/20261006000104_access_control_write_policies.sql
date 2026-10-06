-- MIGRATION 20261006000104_access_control_write_policies.sql
-- UYGULANMADI: 20261006000100..000103 ile AYNI pencerede (PB40), onlardan SONRA uygulanir.
-- Geri alma: supabase/rollbacks/20261006000104_access_control_write_policies.rollback.sql
-- BAGIMLILIK: public.access_audit_log (000102), public.current_tenant_id(), public.current_profile_role().
--
-- AMAC: 000102 access_audit_log icin authenticated'a yalniz SELECT verdi; yetkilendirme ekranindaki server
--   action'lar (kullanici istemcisi, RLS) denetim satiri YAZAMIYORDU. Bu dosya INSERT politikasi + grant ekler.
--   Kural: yalniz kendi ofisine, kendi kimligiyle (created_by = auth.uid()), yonetim rolleriyle (owner/gm/branch_manager).
--   UPDATE/DELETE politikasi YOK: gunluk degistirilemez ve silinemez (yalniz service_role, bakim).
-- ETKI: yalniz ek (yeni politika + grant). Mevcut satir/davranis degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.access_audit_log') is null then
    raise exception 'access_audit_log yok; once 20261006000102_access_audit_log.sql uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.current_profile_role()') is null then
    raise exception 'current_tenant_id()/current_profile_role() yok.';
  end if;
end $$;

drop policy if exists access_audit_log_insert on public.access_audit_log;
create policy access_audit_log_insert on public.access_audit_log
  for insert
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
  );

grant insert on public.access_audit_log to authenticated;

comment on policy access_audit_log_insert on public.access_audit_log is
  'Yetkilendirme degisikligini yapan yonetici (owner/gm/branch_manager) kendi ofisine, kendi kimligiyle denetim satiri ekler. Guncelleme/silme yok.';

notify pgrst, 'reload schema';
