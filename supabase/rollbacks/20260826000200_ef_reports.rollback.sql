-- Rollback: 20260826000200_ef_reports
-- Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ. Restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI.
-- Sira: 20260826000300 rollback -> BU DOSYA -> 20260826000100 rollback.
-- VERI KAYBI: ef_reports satirlari (kullanici <-> EmlakFiyati rapor_id iliskisi) SILINIR; kullanicilar onceki raporlarini/
-- PDF'lerini Emlaksoft'tan acamaz (kontor defteri ve rezerv kayitlari ETKILENMEZ). Satir varsa bilincli onay gerekir:
--   set local emlaksoft.rollback_force = 'on';   -- ayni transaction'da, bu dosyadan once
do $$
begin
  if pg_catalog.to_regclass('public.ef_reports') is not null
    and exists (select 1 from public.ef_reports)
    and coalesce(current_setting('emlaksoft.rollback_force', true), '') <> 'on' then
    raise exception 'ef_reports satir iceriyor; silmek icin ayni transaction''da set local emlaksoft.rollback_force = ''on''.';
  end if;
end
$$;

drop policy if exists ef_reports_select on public.ef_reports;
drop table if exists public.ef_reports;

notify pgrst, 'reload schema';
