-- Rollback: 20261007000220_lc_district_sla_reset. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Ilce kirilimi RPC'leri ve SLA yeniden acilis tetikleyicisi DUSER (yeniden acilan uyari eski davranisa doner: yukseltilmez).
-- Silinmis eski SLA asama kayitlari geri GELMEZ (zaten yeniden acilmis anomalilere aitti). Kod RPC yokken ilce kirilimini
-- gostermez ("etkin degil").

set local lock_timeout = '5s';

drop trigger if exists trg_lc_reset_sla_on_reopen on public.listing_anomalies;
drop function if exists public.lc_reset_sla_on_reopen();
drop function if exists public.listing_control_district_summary(boolean);
drop function if exists public.listing_control_list_district(text, uuid, integer, smallint, uuid, boolean);

notify pgrst, 'reload schema';
