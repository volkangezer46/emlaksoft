-- Rollback: 20261007000610_closure_loss_anomalies
-- Tetikleyici ve fonksiyonlar düşer; 'closure_loss' anomalileri (ve eylem izleri, FK cascade) SİLİNİR; tür CHECK'i eski
-- listeye döner. listing_closures'a DOKUNULMAZ (kaynak kayıtlar yerinde). Kayıp-Kaçak ekranı yoklama ile eski kaynağa düşer.
-- Önce döküm alınabilir: select * from public.listing_anomalies where type = 'closure_loss';

set local lock_timeout = '5s';

drop trigger if exists trg_listing_closures_loss_anomaly on public.listing_closures;
drop function if exists public.lc_closure_loss_trigger();
drop function if exists public.lc_upsert_closure_loss(uuid);
drop function if exists public.lc_closure_loss_ready();

delete from public.listing_anomalies where type = 'closure_loss';

alter table public.listing_anomalies drop constraint if exists listing_anomalies_type_check;
alter table public.listing_anomalies add constraint listing_anomalies_type_check check (type in
  ('portal_missing', 'not_published', 'unregistered_listing', 'bulk_mismatch', 'price_mismatch', 'advisor_mismatch',
   'duplicate', 'potential_lost_deal', 'sold_still_listed', 'incomplete_closure', 'authority_expiring')) not valid;
alter table public.listing_anomalies validate constraint listing_anomalies_type_check;

notify pgrst, 'reload schema';
